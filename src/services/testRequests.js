// Recruiter-requested job-title tests. A recruiter asks one of their connections to take a title test;
// the candidate accepts (and the exact score goes to that recruiter, no option to withhold) or declines.
//
// Credits: each recruiter gets TEST_CREDITS_PER_MONTH per calendar month (New York time), no rollover.
// A credit is held from the moment a request is sent and spent when the candidate completes the test.
// Decline, expiry and a rejected (integrity-failed) attempt give it back. Nothing is counted on the
// recruiter except staff grants: the used count is always derived from TestRequest rows.
// Billing (roadmap) will later set the monthly number per plan; today it is this one setting.
const TestRequest = require('../models/TestRequest');
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const ConnectionRequest = require('../models/ConnectionRequest');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const { notify } = require('./notifications');

const HOUR = 3600000;
const REQUEST_HOURS = 72;
const MAX_PER_CONNECTION = 2;
const MAX_GRANT = 50;
const monthlyCredits = () => Number(process.env.TEST_CREDITS_PER_MONTH) || 3;

const ET_MONTH = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' });
const monthOf = (d = new Date()) => { const p = ET_MONTH.formatToParts(d); return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`; };
const fail = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
const published = (r) => r && r.status === 'completed' && (!r.held || r.reviewDecision === 'approved');
const HOLDING = ['sent', 'accepted', 'completed'];

// Closes requests nobody answered, and accepted ones whose test link ran out. Safe to call any time.
async function expireOverdue(scope = {}, now = new Date()) {
  const sent = await TestRequest.find({ ...scope, status: 'sent', expiresAt: { $lt: now } });
  for (const r of sent) { r.status = 'expired'; await r.save(); }
  const accepted = await TestRequest.find({ ...scope, status: 'accepted' });
  for (const r of accepted) {
    const res = r.resultId ? await SkillResult.findById(r.resultId) : null;
    if (!res || res.status === 'failed' || (['invited', 'started'].includes(res.status) && res.expiresAt && res.expiresAt < now)) {
      r.status = 'expired'; await r.save();
    }
  }
}

async function credits(recruiter) {
  const month = monthOf();
  await expireOverdue({ recruiterId: recruiter._id });
  const bonus = recruiter.testCreditBonus && recruiter.testCreditBonus.month === month ? (recruiter.testCreditBonus.amount || 0) : 0;
  const total = monthlyCredits() + bonus;
  const used = await TestRequest.countDocuments({ recruiterId: recruiter._id, month, status: { $in: HOLDING } });
  return { total, used, left: Math.max(0, total - used), month };
}

// Title tests a recruiter can pick from.
const catalog = () => SkillAssessment.find({ active: true, kind: 'title' }).sort({ name: 1 });

// Throws .code: not_connected | no_test | no_credits | connection_cap | open | recent | manual.
async function sendRequest(recruiter, candidate, assessmentId) {
  const connected = await ConnectionRequest.exists({ candidateId: candidate._id, recruiterId: recruiter._id, status: 'accepted' });
  if (!connected) throw fail('not_connected', 'You can only request a test from a connection');
  const assessment = await SkillAssessment.findOne({ assessmentId, active: true, kind: 'title' });
  if (!assessment) throw fail('no_test', 'That test is not available');
  await expireOverdue({ recruiterId: recruiter._id, candidateId: candidate._id });
  const month = monthOf();
  const same = await TestRequest.exists({ recruiterId: recruiter._id, candidateId: candidate._id, assessmentId, status: { $in: ['sent', 'accepted'] } });
  if (same) throw fail('open', 'Already requested');
  const sentThisMonth = await TestRequest.countDocuments({ recruiterId: recruiter._id, candidateId: candidate._id, month });
  if (sentThisMonth >= MAX_PER_CONNECTION) throw fail('connection_cap', 'Two requests per connection each month');
  // Not worth a credit if the candidate can't take it right now (recent attempt, or staff hold).
  const skills = require('./skills');
  if (await skills.manualHold(candidate._id, assessment)) throw fail('manual', 'Unavailable');
  if (await skills.nextAllowed(candidate._id, assessment)) throw fail('recent', 'Took it recently');
  if ((await credits(recruiter)).left < 1) throw fail('no_credits', 'No credits left this month');

  const sentAt = new Date();
  const request = await TestRequest.create({
    recruiterId: recruiter._id, candidateId: candidate._id, assessmentId, month, sentAt,
    expiresAt: new Date(sentAt.getTime() + REQUEST_HOURS * HOUR)
  });
  // Generic bell and an email, no recruiter message text. Failures never undo the request.
  try { await require('./skillNotifications').requestSent(request, recruiter, candidate, assessment); }
  catch (e) { console.error('[testRequests] candidate notice failed:', e.message); }
  return request;
}

// Requests waiting on this candidate (sent) or in progress (accepted), with who asked and what for.
async function pendingFor(candidate) {
  await expireOverdue({ candidateId: candidate._id });
  const rows = await TestRequest.find({ candidateId: candidate._id, status: { $in: ['sent', 'accepted'] } }).sort({ sentAt: -1 });
  const out = [];
  for (const r of rows) {
    const [rec, a] = await Promise.all([Recruiter.findById(r.recruiterId), SkillAssessment.findOne({ assessmentId: r.assessmentId })]);
    if (!rec) continue;
    out.push({ id: String(r._id), status: r.status, expiresAt: r.expiresAt, test: (a && a.name) || 'Job title assessment',
      recruiter: `${rec.firstName} ${rec.lastName || ''}`.trim(), company: rec.company && rec.company !== 'Not provided' ? rec.company : null });
  }
  return out;
}

async function ownRequest(candidate, id) {
  const r = await TestRequest.findOne({ _id: id, candidateId: candidate._id }).catch(() => null);
  if (!r) throw fail('not_found', 'Request not found');
  return r;
}

// Throws .code not_found | expired | plus startAttempt's own (retake_wait, manual, not_available).
async function accept(candidate, id) {
  const r = await ownRequest(candidate, id);
  await expireOverdue({ candidateId: candidate._id });
  const fresh = await TestRequest.findById(r._id);
  if (!['sent', 'accepted'].includes(fresh.status)) throw fail('expired', 'This request is no longer open');
  const attempt = await require('./skills').startAttempt(candidate, fresh.assessmentId);
  fresh.status = 'accepted';
  fresh.respondedAt = fresh.respondedAt || new Date();
  fresh.resultId = attempt._id;
  await fresh.save();
  return attempt;
}

async function decline(candidate, id) {
  const r = await ownRequest(candidate, id);
  await expireOverdue({ candidateId: candidate._id });
  const fresh = await TestRequest.findById(r._id);
  if (fresh.status !== 'sent') throw fail('expired', 'This request is no longer open');
  fresh.status = 'declined';
  fresh.respondedAt = new Date();
  await fresh.save();
  await notify('recruiter', fresh.recruiterId, 'test_declined', `${candidate.firstName} ${candidate.lastName || ''}`.trim() + ' declined your test request', '/connections');
  return fresh;
}

// Called whenever an attempt's outcome changes (report stored, staff approve or reject). Idempotent.
// Published -> request completes (credit spent) and the recruiter is told once. Rejected -> credit freed.
async function onResult(result) {
  const r = await TestRequest.findOne({ resultId: result._id, status: 'accepted' });
  if (!r || result.status !== 'completed') return null;
  if (result.reviewDecision === 'rejected') { r.status = 'failed'; await r.save(); return r; }
  if (!published(result)) return r; // held for review: the credit stays held, nobody is told yet
  r.status = 'completed';
  r.completedAt = result.completedAt || new Date();
  const first = !r.recruiterNotified;
  r.recruiterNotified = true;
  await r.save();
  if (first) {
    const [c, a, conn] = await Promise.all([Candidate.findById(r.candidateId), SkillAssessment.findOne({ assessmentId: r.assessmentId }),
      ConnectionRequest.findOne({ candidateId: r.candidateId, recruiterId: r.recruiterId, status: 'accepted' })]);
    await notify('recruiter', r.recruiterId, 'test_completed',
      `${c ? `${c.firstName} ${c.lastName || ''}`.trim() : 'A candidate'} finished the ${(a && a.name) || 'job title'} test you requested`,
      conn ? `/recruiter-dashboard/requests/${conn._id}/candidate` : '/connections');
  }
  return r;
}

// Completed, published results this recruiter asked for, shaped like a title result.
async function resultsFor(recruiterId, candidateId) {
  const rows = await TestRequest.find({ recruiterId, candidateId, status: 'completed' }).sort({ completedAt: 1 });
  const skills = require('./skills');
  const out = [];
  for (const r of rows) {
    const res = r.resultId ? await SkillResult.findById(r.resultId) : null;
    if (!res || !published(res) || res.overallScore == null) continue;
    const a = await SkillAssessment.findOne({ assessmentId: r.assessmentId });
    const { result, resultId, showOnProfile, ...t } = skills.titleSummary(res, a);
    out.push({ ...t, requested: true });
  }
  return out;
}

// What the recruiter sees next to a candidate: this month's requests and where each stands.
async function statusFor(recruiter, candidate) {
  await expireOverdue({ recruiterId: recruiter._id, candidateId: candidate._id });
  const rows = await TestRequest.find({ recruiterId: recruiter._id, candidateId: candidate._id, month: monthOf() }).sort({ sentAt: -1 });
  const names = new Map((await SkillAssessment.find({ kind: 'title' })).map((a) => [a.assessmentId, a.name]));
  return rows.map((r) => ({ test: names.get(r.assessmentId) || 'Job title assessment', status: r.status, expiresAt: r.expiresAt, sentAt: r.sentAt }));
}

async function grantCredits(recruiter, amount) {
  const n = Math.floor(Number(amount));
  if (!(n >= 1 && n <= MAX_GRANT)) throw fail('invalid', `Grant between 1 and ${MAX_GRANT}`);
  const month = monthOf();
  const cur = recruiter.testCreditBonus && recruiter.testCreditBonus.month === month ? (recruiter.testCreditBonus.amount || 0) : 0;
  recruiter.testCreditBonus = { month, amount: cur + n };
  await recruiter.save();
  return credits(recruiter);
}

module.exports = { REQUEST_HOURS, MAX_PER_CONNECTION, monthlyCredits, monthOf, expireOverdue, credits, catalog, sendRequest, pendingFor, accept, decline, onResult, resultsFor, statusFor, grantCredits };
