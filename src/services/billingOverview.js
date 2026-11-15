// What staff see on the billing page: counts by status, founding spots, who is in trouble, who is leaving.
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const BillingEvent = require('../models/BillingEvent');
const plans = require('./billingPlans');
const recruiterBilling = require('./recruiterBilling');
const candidateBilling = require('./candidateBilling');

const STATUSES = ['active', 'past_due', 'unpaid', 'canceled', 'incomplete'];

async function countsBy(Model) {
  const out = {};
  for (const s of STATUSES) out[s] = await Model.countDocuments({ 'billing.status': s });
  return out;
}

const row = (type, a) => ({
  type, id: String(a._id), email: a.email,
  name: [a.firstName, a.lastName].filter(Boolean).join(' '),
  plan: a.billing.plan, status: a.billing.status,
  graceUntil: a.billing.graceUntil, periodEnd: a.billing.currentPeriodEnd,
  founding: Boolean(a.billing.founding && a.billing.founding.lockedAt),
});

async function load(now = new Date()) {
  const [rc, cc, wave, candLeft] = [await countsBy(Recruiter), await countsBy(Candidate), await recruiterBilling.waveCounts(now), await candidateBilling.foundingSpotsLeft(now)];
  const trouble = [];
  const leaving = [];
  for (const [type, Model] of [['recruiter', Recruiter], ['candidate', Candidate]]) {
    (await Model.find({ 'billing.status': { $in: ['past_due', 'unpaid'] } }).sort({ 'billing.graceUntil': 1 }).limit(50)).forEach((a) => trouble.push(row(type, a)));
    (await Model.find({ 'billing.status': 'active', 'billing.cancelAtPeriodEnd': true }).sort({ 'billing.currentPeriodEnd': 1 }).limit(50)).forEach((a) => leaving.push(row(type, a)));
  }
  const events = await BillingEvent.find({}).sort({ createdAt: -1 }).limit(25);
  return {
    recruiters: rc, candidates: cc,
    waves: plans.WAVES.map((w) => ({ wave: w.wave, size: w.size, taken: wave[w.wave] || 0, price: plans.waveCents(w) / 100, label: w.label, locked: w.locked })),
    candidateFounding: { size: plans.FOUNDING_CANDIDATES, left: candLeft },
    trouble, leaving,
    events: events.map((e) => ({ at: e.createdAt, type: e.type, ownerType: e.ownerType, note: e.note })),
  };
}

module.exports = { load, STATUSES };
