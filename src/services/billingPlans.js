// Recruiter prices and founding waves. Prices live in Stripe; we find them by lookup key and create
// them the first time they are needed, so nobody has to click them together by hand.
//
// All amounts are LOCKED (Kent, Oct 28). Tax is added on top at checkout by Stripe Tax.
const PLANS = {
  recruiter_monthly: { key: 'precheckd_recruiter_monthly', name: 'PreCheckd Recruiter (monthly)', cents: 5900, interval: 'month' },
  recruiter_annual: { key: 'precheckd_recruiter_annual', name: 'PreCheckd Recruiter (annual)', cents: 49900, interval: 'year' },
  founding_1: { key: 'precheckd_recruiter_founding_1', name: 'PreCheckd Founding Recruiter (annual, first 100)', cents: 24900, interval: 'year' },
  founding_2: { key: 'precheckd_recruiter_founding_2', name: 'PreCheckd Founding Recruiter (annual, next 150)', cents: 34900, interval: 'year' },
};

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
    price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: plan.cents,
      recurring: { interval: plan.interval },
      lookup_key: plan.key,
      tax_behavior: 'exclusive',
      product_data: { name: plan.name },
    });
  }
  cache.set(planName, price.id);
  return price.id;
}

function clearCache() { cache.clear(); }

module.exports = { PLANS, WAVES, RESERVE_MINUTES, BASE_OPEN_POSTINGS, waveStatus, choosePlan, ensurePrice, clearCache };
