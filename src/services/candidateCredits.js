// Candidate skill-test credits (only enforced while billing is on; until then tests stay unlimited).
//
//  - 3 a month (CANDIDATE_CREDITS_PER_MONTH), no rollover. The month runs from the day they became a member
//    (the verification day until billing has a member-since date) to the same day next month.
//  - A credit is spent when a NEW skill test is started. Continuing an open one is free, and so are recruiter-requested,
//    role, job-title, finalist and custom tests (they never come through here).
//  - An invite that was never opened and has expired gives its credit back.
//  - Bonus credits (granted by staff after a request) never expire and are spent after the monthly ones.
//  - Nothing is decremented: used is counted from SkillResult rows, so refunds are automatic.
const SkillResult = require('../models/SkillResult');
const CreditRequest = require('../models/CreditRequest');
const billingConfig = require('../config/billing');
const { notify } = require('./notifications');

const monthlyTotal = () => Number(process.env.CANDIDATE_CREDITS_PER_MONTH) || 3;
const MAX_REQUEST = 10;
const fail = (code, msg, extra) => Object.assign(new Error(msg || code), { code }, extra || {});
const enabled = () => billingConfig.enabled();

// Pure: the current credit month, from an anchor date. Day-of-month is clamped to the month's length.
function creditWindow(anchor, now = new Date()) {
  const a = new Date(anchor), n = new Date(now);
  const at = (y, m) => new Date(Date.UTC(y, m, Math.min(a.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()), a.getUTCHours(), a.getUTCMinutes()));
  let months = (n.getUTCFullYear() - a.getUTCFullYear()) * 12 + (n.getUTCMonth() - a.getUTCMonth());
  if (months < 0) months = 0;
  let start = at(a.getUTCFullYear(), a.getUTCMonth() + months);
  if (start > n) { months -= 1; start = at(a.getUTCFullYear(), a.getUTCMonth() + months); }
  if (months < 0) start = new Date(a);
  const end = at(a.getUTCFullYear(), a.getUTCMonth() + months + 1);
  return { start, end };
}

const anchorOf = (c) => (c.billing && c.billing.memberSince) || c.identityVerifiedAt || c.createdAt || new Date();

// Never opened and no longer usable: the credit comes back.
const refunded = (r, now) => !r.startedAt && ((r.status === 'invited' && r.expiresAt && new Date(r.expiresAt) < now) || r.status === 'failed');

// Pure: what a candidate has, given the rows that spent credits.
function tally({ rows, granted = 0, perMonth = monthlyTotal(), window, now = new Date() }) {
  const live = rows.filter((r) => !refunded(r, now));
  const monthlyUsed = live.filter((r) => r.creditSpent === 'monthly' && r.invitedAt && new Date(r.invitedAt) >= window.start && new Date(r.invitedAt) < window.end).length;
  const bonusUsed = live.filter((r) => r.creditSpent === 'bonus').length;
  const monthlyLeft = Math.max(0, perMonth - monthlyUsed);
  const bonusLeft = Math.max(0, granted - bonusUsed);
  return { perMonth, monthlyUsed, monthlyLeft, bonusLeft, left: monthlyLeft + bonusLeft, resetsAt: window.end };
}

async function summary(candidate, now = new Date()) {
  const rows = await SkillResult.find({ candidateId: candidate._id, creditSpent: { $ne: null } });
  const t = tally({ rows, granted: candidate.creditBonusGranted || 0, window: creditWindow(anchorOf(candidate), now), now });
  const open = await CreditRequest.findOne({ candidateId: candidate._id, status: 'open' });
  const lastDecided = await CreditRequest.findOne({ candidateId: candidate._id, status: { $in: ['approved', 'declined'] } }).sort({ decidedAt: -1 });
  return Object.assign(t, { enabled: enabled(), open, lastDecided });
}

// Hooks for skills.startAttempt. They do nothing while billing is off.
function hooks(candidate) {
  if (!enabled()) return {};
  let plan = null;
  return {
    beforeInvite: async (assessment) => {
      if ((assessment.kind || 'skill') !== 'skill') return;
      const s = await summary(candidate);
      if (s.left < 1) throw fail('no_credits', 'No credits left', { resetsAt: s.resetsAt });
      plan = s.monthlyLeft > 0 ? 'monthly' : 'bonus';
    },
    afterInvite: async (result) => {
      if (!plan) return;
      result.creditSpent = plan;
      await result.save();
    },
  };
}

// ---- asking for more -------------------------------------------------------------------------------------
async function requestMore(candidate, amount, reason) {
  const n = Math.floor(Number(amount));
  const text = String(reason || '').trim().slice(0, 500);
  if (!(n >= 1 && n <= MAX_REQUEST)) throw fail('bad_amount', `Ask for 1 to ${MAX_REQUEST} credits.`);
  if (text.length < 5) throw fail('no_reason', 'Tell us briefly why you need them.');
  if (await CreditRequest.findOne({ candidateId: candidate._id, status: 'open' })) throw fail('open', 'You already have a request waiting.');
  const created = await CreditRequest.create({ candidateId: candidate._id, amount: n, reason: text });
  try {
    await require('./emailService').sendStaffAlertEmail({ subject: 'A candidate asked for more test credits', headline: 'Credit request',
      paragraphs: [`${candidate.firstName} ${candidate.lastName || ''}`.trim() + ` asked for ${n} credit${n === 1 ? '' : 's'}: "${text}"`], buttonUrl: (process.env.ADMIN_BASE_URL || '') + '/credit-requests', buttonLabel: 'Review' });
  } catch (e) { console.error('Credit request alert failed:', e.message); }
  return created;
}

// Staff decision. `grant` is how many to give (0 declines); `note` is shown to the candidate.
async function decide(requestId, { grant, note }) {
  const Candidate = require('../models/Candidate');
  const r = await CreditRequest.findById(requestId);
  if (!r || r.status !== 'open') throw fail('closed', 'That request is already decided.');
  const g = Math.max(0, Math.min(MAX_REQUEST, Math.floor(Number(grant) || 0)));
  r.status = g > 0 ? 'approved' : 'declined';
  r.grantedAmount = g;
  r.staffNote = String(note || '').trim().slice(0, 500);
  r.decidedAt = new Date();
  await r.save();
  const c = await Candidate.findById(r.candidateId);
  if (c && g > 0) { c.creditBonusGranted = (c.creditBonusGranted || 0) + g; await c.save(); }
  if (c) {
    await notify('candidate', c._id, 'credits_decided',
      g > 0 ? `You now have ${g} more test credit${g === 1 ? '' : 's'}.${r.staffNote ? ' ' + r.staffNote : ''}` : `About your credit request.${r.staffNote ? ' ' + r.staffNote : ' We could not add credits this time.'}`,
      `/candidate/${c.slug}/skills`);
  }
  return r;
}

module.exports = { creditWindow, tally, summary, hooks, requestMore, decide, enabled, monthlyTotal, MAX_REQUEST, anchorOf };
