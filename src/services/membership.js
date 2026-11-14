// Is this account a paying member right now? A pure reading of the billing subdocument.
//
//   active  - paid up (Stripe status 'active')
//   grace   - a payment failed; access continues until graceUntil (14 days)
//   lapsed  - grace ran out, or the subscription was cancelled and its paid period ended
//   none    - never subscribed
//
// While BILLING_ENABLED is off, everyone counts as a member and nothing is ever blocked.
const billingConfig = require('../config/billing');

const DAY = 86400000;

function state(account, now = new Date()) {
  const b = (account && account.billing) || {};
  const status = b.status || 'none';
  const t = new Date(now).getTime();
  if (status === 'active') {
    // A cancelled-at-period-end subscription stays 'active' in Stripe until the period closes.
    return { status: 'active', graceUntil: null };
  }
  if (status === 'past_due' || status === 'unpaid') {
    const until = b.graceUntil ? new Date(b.graceUntil).getTime() : null;
    if (until && t < until) return { status: 'grace', graceUntil: new Date(until) };
    return { status: 'lapsed', graceUntil: until ? new Date(until) : null };
  }
  if (status === 'canceled') {
    // Access runs to the end of the period that was paid for.
    const end = b.currentPeriodEnd ? new Date(b.currentPeriodEnd).getTime() : null;
    if (end && t < end) return { status: 'active', graceUntil: null };
    return { status: 'lapsed', graceUntil: null };
  }
  return { status: 'none', graceUntil: null };
}

// True when the account may use paid features.
function isMember(account, now) {
  if (!billingConfig.enabled()) return true;
  const s = state(account, now).status;
  return s === 'active' || s === 'grace';
}

// A candidate whose public pages should read "not a member anymore". Never-subscribed accounts are not
// shown as lapsed (they are mid-signup); only someone who was a member and stopped.
function isLapsed(account, now) {
  if (!billingConfig.enabled()) return false;
  return state(account, now).status === 'lapsed';
}

// Value for the apply gate's `membershipActive`: undefined (not checked) while billing is off.
function gateFact(account, now) {
  if (!billingConfig.enabled()) return undefined;
  return isMember(account, now);
}

// Days of grace left, rounded up, for the warning banner. null when not in grace.
function graceDaysLeft(account, now = new Date()) {
  const s = state(account, now);
  if (s.status !== 'grace' || !s.graceUntil) return null;
  return Math.max(1, Math.ceil((s.graceUntil.getTime() - new Date(now).getTime()) / DAY));
}

module.exports = { state, isMember, isLapsed, gateFact, graceDaysLeft };
