// Recruiter prices and founding waves. Prices live in Stripe; we find them by lookup key and create
// them the first time they are needed, so nobody has to click them together by hand.
//
// All amounts are LOCKED (Kent, Oct 28). Tax is added on top at checkout by Stripe Tax.
const PLANS = {
  recruiter_monthly: { key: 'precheckd_recruiter_monthly', name: 'PreCheckd Recruiter (monthly)', cents: 5900, interval: 'month' },
  recruiter_annual: { key: 'precheckd_recruiter_annual', name: 'PreCheckd Recruiter (annual)', cents: 49900, interval: 'year' },
  founding_1: { key: 'precheckd_recruiter_founding_1', name: 'PreCheckd Founding Recruiter (annual, first 100)', cents: 24900, interval: 'year' },
  founding_2: { key: 'precheckd_recruiter_founding_2', name: 'PreCheckd Founding Recruiter (annual, next 150)', cents: 34900, interval: 'year' },
  // Candidates. `interval: null` is a one-time charge (the verification fee).
  candidate_monthly: { key: 'precheckd_candidate_monthly', name: 'PreCheckd Membership (monthly)', cents: 1500, interval: 'month' },
  candidate_annual: { key: 'precheckd_candidate_annual', name: 'PreCheckd Membership (annual)', cents: 12000, interval: 'year' },
  candidate_fee: { key: 'precheckd_candidate_verification_fee', name: 'PreCheckd verification fee (one time)', cents: 7900, interval: null },
};

// The first 1,000 candidates skip the $79 verification fee ("Founding Candidates"). The ID check still runs.
const FOUNDING_CANDIDATES = 1000;

const WAVES = [
  { wave: 1, size: 100, plan: 'founding_1' },
  { wave: 2, size: 150, plan: 'founding_2' },
];

const RESERVE_MINUTES = 35;
const BASE_OPEN_POSTINGS = 5;

// Pure: given how many spots are taken in each wave ({1: n, 2: n}), which wave is open and what is left.
function waveStatus(taken = {}) {
  for (const w of WAVES) {
    const used = Number(taken[w.wave]) || 0;
    if (used < w.size) {
      return { wave: w.wave, plan: w.plan, priceCents: PLANS[w.plan].cents, spotsLeft: w.size - used, size: w.size };
    }
  }
  return { wave: null, plan: null, priceCents: PLANS.recruiter_annual.cents, spotsLeft: 0, size: 0 };
}

// Pure: which plan a recruiter gets for the interval they picked. Founding price is annual only, and only for
// someone who has never held a founding spot.
function choosePlan({ interval, status, hadFounding }) {
  if (interval === 'monthly') return { plan: 'recruiter_monthly', wave: null };
  if (interval !== 'annual') return null;
  if (status.wave && !hadFounding) return { plan: status.plan, wave: status.wave };
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
  if (!price) {
    const spec = {
      currency: 'usd',
      unit_amount: plan.cents,
      lookup_key: plan.key,
      tax_behavior: 'exclusive',
      product_data: { name: plan.name },
    };
    if (plan.interval) spec.recurring = { interval: plan.interval };
    price = await stripe.prices.create(spec);
  }
  cache.set(planName, price.id);
  return price.id;
}

function clearCache() { cache.clear(); }

// Pure: the first-checkout choices for a candidate. `feeDue` is true only for someone who has never been ID verified,
// never paid the fee, and did not get a founding spot.
function chooseCandidatePlan({ interval, foundingSpotsLeft, alreadyFounding, hadFee, idVerified }) {
  if (interval !== 'monthly' && interval !== 'annual') return null;
  const plan = interval === 'monthly' ? 'candidate_monthly' : 'candidate_annual';
  const founding = alreadyFounding || foundingSpotsLeft > 0;
  const feeDue = !founding && !hadFee && !idVerified;
  return { plan, founding, feeDue };
}

module.exports = { PLANS, WAVES, FOUNDING_CANDIDATES, chooseCandidatePlan, RESERVE_MINUTES, BASE_OPEN_POSTINGS, waveStatus, choosePlan, ensurePrice, clearCache };
