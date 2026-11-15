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

// ---- Recruiters -------------------------------------------------------------------------------------------

const plansConfig = require('./billingPlans');

// How many postings can be open at once: 5 in the plan plus slots bought as an add-on (while that add-on is paid up).
function openLimit(recruiter) {
  const slots = recruiter && recruiter.billing && recruiter.billing.slots;
  const live = slots && (slots.status === 'active' || slots.status === 'past_due');
  const extra = live ? Number(slots.quantity) || 0 : 0;
  return plansConfig.BASE_OPEN_POSTINGS + Math.max(0, extra);
}

// Express middleware for recruiter-only paid areas. Lets everyone through while billing is off.
// Pages get sent to the plan page; API calls get a 402.
function requireRecruiterMember(req, res, next) {
  if (!billingConfig.enabled()) return next();
  if (!req.session || !req.session.recruiterId) return next(); // the login check elsewhere handles this
  const Recruiter = require('../models/Recruiter');
  Recruiter.findById(req.session.recruiterId).then((r) => {
    if (!r || isMember(r)) return next();
    const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
    if (wantsJson) return res.status(402).json({ error: 'Your membership is not active.', needsPayment: true });
    return res.redirect('/billing?needed=1');
  }).catch(next);
}

// Postings by recruiters who stopped paying are hidden from the board and from job alerts.
async function visiblePostings(postings) {
  if (!billingConfig.enabled() || !postings.length) return postings;
  const Recruiter = require('../models/Recruiter');
  const ids = [...new Set(postings.map((p) => String(p.recruiterId)))];
  const owners = await Recruiter.find({ _id: { $in: ids } }).select('billing');
  const ok = new Set(owners.filter((r) => isMember(r)).map((r) => String(r._id)));
  return postings.filter((p) => ok.has(String(p.recruiterId)));
}

async function postingVisible(posting) {
  return (await visiblePostings([posting])).length === 1;
}

module.exports.openLimit = openLimit;
module.exports.requireRecruiterMember = requireRecruiterMember;
module.exports.visiblePostings = visiblePostings;
module.exports.postingVisible = postingVisible;
