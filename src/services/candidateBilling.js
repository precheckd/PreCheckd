// Candidate membership: $79 one-time verification fee (waived for the first 1,000) plus $15/month or $120/year,
// taken in one Stripe Checkout before the ID check.
const Candidate = require('../models/Candidate');
const plans = require('./billingPlans');
const sync = require('./billingSync');

async function foundingTaken(now = new Date()) {
  const cutoff = new Date(new Date(now).getTime() - plans.RESERVE_MINUTES * 60000);
  return Candidate.countDocuments({
    'billing.founding.wave': 1,
    $or: [
      { 'billing.founding.lockedAt': { $ne: null }, 'billing.status': { $in: ['active', 'past_due', 'unpaid', 'canceled'] } },
      { 'billing.founding.lockedAt': null, 'billing.founding.reservedAt': { $gt: cutoff } },
    ],
  });
}

// A founding spot, once earned, is kept even if the person later lapses: it only decides the $79 fee, which is paid once.
async function foundingSpotsLeft(now) {
  return Math.max(0, plans.FOUNDING_CANDIDATES - await foundingTaken(now));
}

const alreadyFounding = (c) => Boolean(c.billing && c.billing.founding && c.billing.founding.lockedAt);
const hadFee = (c) => Boolean(c.billing && c.billing.verificationFee && c.billing.verificationFee.paidAt);

// Sets keys on the nested verificationFee object one by one (works for Mongoose nested paths and plain objects).
function setFee(candidate, patch) {
  if (!candidate.billing.verificationFee) candidate.billing.verificationFee = {};
  Object.keys(patch).forEach((k) => { candidate.billing.verificationFee[k] = patch[k]; });
}

async function ensureCustomer(stripe, candidate) {
  if (candidate.billing.customerId) return candidate.billing.customerId;
  const customer = await stripe.customers.create({
    email: candidate.email,
    name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || undefined,
    phone: candidate.phone || undefined,
    metadata: { ownerType: 'candidate', ownerId: String(candidate._id) },
  });
  candidate.billing.customerId = customer.id;
  await candidate.save();
  return customer.id;
}

async function startCheckout({ stripe, candidate, interval, baseUrl, successPath, cancelPath, now = new Date() }) {
  const choice = plans.chooseCandidatePlan({
    interval, foundingSpotsLeft: await foundingSpotsLeft(now), alreadyFounding: alreadyFounding(candidate),
    hadFee: hadFee(candidate), idVerified: Boolean(candidate.isIdentityVerified),
  });
  if (!choice) { const e = new Error('Pick monthly or annual.'); e.code = 'bad_interval'; throw e; }
  if (candidate.billing.status === 'active') { const e = new Error('Already subscribed.'); e.code = 'already_active'; throw e; }

  const customerId = await ensureCustomer(stripe, candidate);
  const lineItems = [{ price: await plans.ensurePrice(stripe, choice.plan), quantity: 1 }];
  if (choice.feeDue) lineItems.push({ price: await plans.ensurePrice(stripe, 'candidate_fee'), quantity: 1 });

  // Hold the founding spot while they pay.
  const f = candidate.billing.founding || {};
  if (choice.founding && !alreadyFounding(candidate)) {
    candidate.billing.founding = { wave: 1, priceCents: 0, reservedAt: new Date(now), lockedAt: null };
  } else if (!choice.founding && !alreadyFounding(candidate) && f.wave) {
    candidate.billing.founding = { wave: null, priceCents: null, reservedAt: null, lockedAt: null };
  }
  setFee(candidate, { waived: choice.founding });
  if (candidate.billing.status === 'none') candidate.billing.status = 'incomplete';
  await candidate.save();

  const owner = { ownerType: 'candidate', ownerId: String(candidate._id) };
  const meta = Object.assign({}, owner, { verificationFee: choice.feeDue ? '1' : '0' });
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(candidate._id),
    line_items: lineItems,
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    customer_update: { address: 'auto', name: 'auto' },
    allow_promotion_codes: false,
    metadata: meta,
    subscription_data: { metadata: owner },
    success_url: `${baseUrl}${successPath}${successPath.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}${cancelPath}`,
  });
  return { url: session.url, plan: choice.plan, founding: choice.founding, feeDue: choice.feeDue };
}

// Marks the fee as paid when a paid session says it included one. Safe to call twice.
function recordFee(candidate, sessionMetadata, now = new Date()) {
  if (sessionMetadata && sessionMetadata.verificationFee === '1' && !(candidate.billing.verificationFee && candidate.billing.verificationFee.paidAt)) {
    setFee(candidate, { paidAt: new Date(now) });
  }
}

async function confirmReturn({ stripe, candidate, sessionId, now = new Date() }) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session || session.client_reference_id !== String(candidate._id)) { const e = new Error('That payment is not yours.'); e.code = 'mismatch'; throw e; }
  if (session.mode !== 'subscription' || !session.subscription) { const e = new Error('Not a subscription.'); e.code = 'not_subscription'; throw e; }
  if (session.payment_status !== 'paid') return { paid: false };
  const subId = typeof session.subscription === 'object' ? session.subscription.id : session.subscription;
  const sub = await stripe.subscriptions.retrieve(subId);
  sync.applySubscription(candidate.billing, sub, now);
  recordFee(candidate, session.metadata, now);
  await candidate.save();
  return { paid: candidate.billing.status === 'active' };
}

async function portalUrl({ stripe, candidate, returnUrl }) {
  if (!candidate.billing.customerId) { const e = new Error('No billing account yet.'); e.code = 'no_customer'; throw e; }
  const s = await stripe.billingPortal.sessions.create({ customer: candidate.billing.customerId, return_url: returnUrl });
  return s.url;
}

module.exports = { foundingTaken, foundingSpotsLeft, startCheckout, confirmReturn, recordFee, portalUrl, alreadyFounding, hadFee };
