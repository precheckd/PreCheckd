// Keeps our copy of a subscription (the `billing` block on a Recruiter or Candidate) in step with Stripe.
// Every function takes plain data, so the rules can be tested without Stripe or a database.
const { GRACE_DAYS } = require('../config/billing');

const DAY = 86400000;

// Stripe subscription status -> ours.
function mapStatus(s) {
  switch (s) {
    case 'active': case 'trialing': return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid': return 'unpaid';
    case 'incomplete': return 'incomplete';
    case 'canceled': case 'incomplete_expired': return 'canceled';
    default: return 'none';
  }
}

function planOf(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const interval = item && item.price && item.price.recurring && item.price.recurring.interval;
  return interval === 'year' ? 'annual' : interval === 'month' ? 'monthly' : null;
}

function periodEnd(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const secs = (sub && sub.current_period_end) || (item && item.current_period_end);
  return secs ? new Date(secs * 1000) : null;
}

// Mutates `billing` (a plain object or Mongoose subdocument) from a Stripe subscription object.
function applySubscription(billing, sub, now = new Date()) {
  const status = mapStatus(sub.status);
  billing.subscriptionId = sub.id;
  if (sub.customer) billing.customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  billing.status = status;
  billing.plan = planOf(sub) || billing.plan || null;
  billing.cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  const end = periodEnd(sub);

  if (status === 'active') {
    if (!billing.memberSince) billing.memberSince = new Date(now);
    billing.graceUntil = null;
    if (end) billing.currentPeriodEnd = end;
  } else if (status === 'past_due' || status === 'unpaid') {
    // Grace starts the first time we see the failure and is never extended by later retries.
    if (!billing.graceUntil) billing.graceUntil = new Date(new Date(now).getTime() + GRACE_DAYS * DAY);
    if (end) billing.currentPeriodEnd = end;
  } else if (status === 'canceled') {
    // Cancelled at the end of the paid period: keep that date. Ended early (failed payments, staff): access stops now.
    if (sub.cancel_at_period_end && end) billing.currentPeriodEnd = end;
    else billing.currentPeriodEnd = new Date(now);
    billing.graceUntil = null;
  }

  // A founding spot becomes permanent the first time the subscription is paid.
  if (status === 'active' && billing.founding && billing.founding.wave && !billing.founding.lockedAt) {
    billing.founding.lockedAt = new Date(now);
  }
  return billing;
}

// invoice.payment_failed: start the 14-day grace if it has not started.
function applyPaymentFailed(billing, now = new Date()) {
  // A first payment that never went through (status 'incomplete') is not a lapse, so only an active account enters grace.
  if (billing.status === 'active') billing.status = 'past_due';
  if (billing.status === 'past_due' && !billing.graceUntil) {
    billing.graceUntil = new Date(new Date(now).getTime() + GRACE_DAYS * DAY);
  }
  return billing;
}

// invoice.paid: back in good standing.
function applyPaid(billing, invoice) {
  billing.status = 'active';
  billing.graceUntil = null;
  const line = invoice && invoice.lines && invoice.lines.data && invoice.lines.data[0];
  const end = line && line.period && line.period.end;
  if (end) billing.currentPeriodEnd = new Date(end * 1000);
  return billing;
}

module.exports = { mapStatus, planOf, periodEnd, applySubscription, applyPaymentFailed, applyPaid };
