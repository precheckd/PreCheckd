// Recruiter prices and founding waves. Prices live in Stripe; we find them by lookup key and create
// them the first time they are needed, so nobody has to click them together by hand.
//
// Standard price set Nov 15 to $249/month and $1,999/year so the launch offers read as deep discounts (Kent).
// Tax is added on top at checkout by Stripe Tax.
const PLANS = {
  recruiter_monthly: { key: 'precheckd_recruiter_monthly', name: 'PreCheckd Recruiter (monthly)', cents: 24900, interval: 'month' },
  recruiter_annual: { key: 'precheckd_recruiter_annual', name: 'PreCheckd Recruiter (annual)', cents: 199900, interval: 'year' },
  // The one Founders price ($349/year, locked while subscribed). The first 100 get it after a free year (invite only).
  founding_2: { key: 'precheckd_recruiter_founding_2', name: 'PreCheckd Founding Recruiter (annual)', cents: 34900, interval: 'year' },
  // Add-ons for recruiters. The slot price is graduated: slots 1-5 are $10 each, 6-10 $8 each, 11 and up $6 each, per month.
  recruiter_slot: { key: 'precheckd_recruiter_slot', name: 'PreCheckd extra open job posting slot (monthly)', interval: 'month', cents: 1000,
    tiers: [{ up_to: 5, unit_amount: 1000 }, { up_to: 10, unit_amount: 800 }, { up_to: 'inf', unit_amount: 600 }] },
  recruiter_credit_pack: { key: 'precheckd_recruiter_credit_pack', name: 'PreCheckd job title test credits (pack of 3)', cents: 3900, interval: null },
  // Candidates. `interval: null` is a one-time charge (the verification fee).
  candidate_monthly: { key: 'precheckd_candidate_monthly', name: 'PreCheckd Membership (monthly)', cents: 1500, interval: 'month' },
  candidate_annual: { key: 'precheckd_candidate_annual', name: 'PreCheckd Membership (annual)', cents: 12000, interval: 'year' },
  candidate_fee: { key: 'precheckd_candidate_verification_fee', name: 'PreCheckd verification fee (one time)', cents: 7900, interval: null },
};

// The first 1,000 candidates skip the $79 verification fee ("Founding Candidates"). The ID check still runs.
const FOUNDING_CANDIDATES = 1000;

// Four steps, 1,000 recruiters in all. Steps 1-2 are the FOUNDERS (first 250): $349 a year, locked for as long as they stay
// subscribed. Step 1 is INVITE ONLY (Kent, Nov 21): the first 100 get their first year free (a Stripe trial, card on file)
// and only through a personal invite code, so the public sees $349 from day one (step 2). Steps 3-4 are EARLY ACCESS: a
// lower first-year price (the standard annual price with a one-time discount in Stripe), then they renew at the standard
// price. Nothing is locked for them.
const FREE_YEAR_DAYS = 365;
const WAVES = [
  { wave: 1, size: 100, plan: 'founding_2', locked: true, label: 'Founding', inviteOnly: true, freeDays: FREE_YEAR_DAYS },
  { wave: 2, size: 150, plan: 'founding_2', locked: true, label: 'Founding' },
  { wave: 3, size: 250, plan: 'recruiter_annual', introCents: 44900, locked: false, label: 'Early Access' },
  { wave: 4, size: 500, plan: 'recruiter_annual', introCents: 54900, locked: false, label: 'Early Access' },
];
const waveCents = (w) => (w.introCents != null ? w.introCents : PLANS[w.plan].cents);

const RESERVE_MINUTES = 35;
const BASE_OPEN_POSTINGS = 5;
const CREDITS_PER_PACK = 3;
const MAX_PACKS_AT_ONCE = 5;
const MAX_EXTRA_SLOTS = 50;

// Pure: monthly cost in cents of `qty` extra slots on the graduated price.
function slotMonthlyCents(qty) {
  let left = Math.max(0, Math.floor(Number(qty) || 0)), from = 0, total = 0;
  for (const tier of PLANS.recruiter_slot.tiers) {
    const upTo = tier.up_to === 'inf' ? Infinity : tier.up_to;
    const inTier = Math.min(left, upTo - from);
    if (inTier > 0) { total += inTier * tier.unit_amount; left -= inTier; }
    from = upTo;
    if (left <= 0) break;
  }
  return total;
}

// Pure: given how many spots are taken in each wave ({1: n, 2: n}), which wave is open and what is left.
// Invite-only steps are skipped unless `invite` is true (the visitor holds a valid invite).
function waveStatus(taken = {}, { invite = false } = {}) {
  for (const w of WAVES) {
    if (w.inviteOnly && !invite) continue;
    const used = Number(taken[w.wave]) || 0;
    if (used < w.size) {
      return { wave: w.wave, plan: w.plan, priceCents: waveCents(w), standardCents: PLANS.recruiter_annual.cents,
        locked: w.locked, label: w.label, spotsLeft: w.size - used, size: w.size, freeDays: w.freeDays || 0 };
    }
  }
  return { wave: null, plan: null, priceCents: PLANS.recruiter_annual.cents, standardCents: PLANS.recruiter_annual.cents, locked: false, label: null, spotsLeft: 0, size: 0, freeDays: 0 };
}

// Pure: which plan a recruiter gets for the interval they picked. Founding price is annual only, and only for
// someone who has never held a founding spot.
function choosePlan({ interval, status, hadFounding }) {
  if (interval === 'monthly') return { plan: 'recruiter_monthly', wave: null };
  if (interval !== 'annual') return null;
  if (status.wave && !hadFounding) {
    const choice = { plan: status.plan, wave: status.wave };
    if (status.freeDays) choice.freeDays = status.freeDays;
    // Early Access: standard annual price, first invoice reduced by a one-time coupon.
    if (!status.locked) { choice.discountCents = status.standardCents - status.priceCents; choice.locked = false; } else choice.locked = true;
    return choice;
  }
  return { plan: 'recruiter_annual', wave: null };
}

const cache = new Map();

// Finds (or creates) the Stripe price for a plan. Safe to call any number of times.
async function ensurePrice(stripe, planName) {
  const plan = PLANS[planName];
  if (!plan) throw new Error('Unknown plan: ' + planName);
  if (cache.has(planName)) return cache.get(planName);
  const found = await stripe.prices.list({ lookup_keys: [plan.key], active: true, limit: 1 });
  let price = found.data && found.data[0];
  // If the amount we want has changed since the price was made, make a new one and move the lookup key to it.
  const stale = price && !plan.tiers && Number.isFinite(price.unit_amount) && price.unit_amount !== plan.cents;
  if (!price || stale) {
    const spec = {
      currency: 'usd',
      lookup_key: plan.key,
      tax_behavior: 'exclusive',
      product_data: { name: plan.name },
    };
    if (plan.tiers) { spec.billing_scheme = 'tiered'; spec.tiers_mode = 'graduated'; spec.tiers = plan.tiers; }
    else spec.unit_amount = plan.cents;
    if (plan.interval) spec.recurring = { interval: plan.interval };
    if (stale) spec.transfer_lookup_key = true;
    price = await stripe.prices.create(spec);
  }
  cache.set(planName, price.id);
  return price.id;
}

function clearCache() { cache.clear(); }

// The one-time first-year discount for Early Access steps. Found by id, created the first time it is needed.
async function ensureCoupon(stripe, amountOff) {
  const id = 'precheckd_early_access_' + amountOff;
  try { return (await stripe.coupons.retrieve(id)).id; }
  catch (e) { if (e && e.code && e.code !== 'resource_missing') throw e; }
  const c = await stripe.coupons.create({ id, amount_off: amountOff, currency: 'usd', duration: 'once', name: 'PreCheckd Early Access, first year' });
  return c.id;
}

// Pure: the first-checkout choices for a candidate. `feeDue` is true only for someone who has never been ID verified,
// never paid the fee, and did not get a founding spot.
function chooseCandidatePlan({ interval, foundingSpotsLeft, alreadyFounding, hadFee, idVerified }) {
  if (interval !== 'monthly' && interval !== 'annual') return null;
  const plan = interval === 'monthly' ? 'candidate_monthly' : 'candidate_annual';
  const founding = alreadyFounding || foundingSpotsLeft > 0;
  const feeDue = !founding && !hadFee && !idVerified;
  return { plan, founding, feeDue };
}

module.exports = { FREE_YEAR_DAYS, CREDITS_PER_PACK, MAX_PACKS_AT_ONCE, MAX_EXTRA_SLOTS, slotMonthlyCents, PLANS, WAVES, FOUNDING_CANDIDATES, chooseCandidatePlan, RESERVE_MINUTES, BASE_OPEN_POSTINGS, waveStatus, choosePlan, ensurePrice, ensureCoupon, clearCache, waveCents };
