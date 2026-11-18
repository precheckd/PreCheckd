// Finalist (second-stage) tests. A recruiter picks 3 of the 5 general topics for a posting (locked once the first
// invite goes out), then invites up to FINALIST_SLOTS applicants to the one combined test that covers them.
//
// Slots: a slot is held while a request is sent, accepted or completed. Declined, expired and integrity-rejected
// requests give it back. There is no extra charge and no recruiter test credit is used; nothing counts against the
// candidate's own monthly credits either (finalist tests are never spent from them).
//
// A request that ends without a score never rejects anyone by itself. The recruiter sees a notice and chooses
// Keep or Reject. Only if they turned the posting's auto-reject switch ON does it reject, with the fixed reason
// "did not complete the finalist assessment".
const FinalistTest = require('../models/FinalistTest');
const JobApplication = require('../models/JobApplication');
const JobPosting = require('../models/JobPosting');
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const Candidate = require('../models/Candidate');
const topicsContent = require('../content/finalistTopics');
const { notify } = require('./notifications');
const jobApps = require('./jobApplications');
const { ACTIVE } = jobApps;

const HOUR = 3600000;
const REQUEST_HOURS = 72;
const FINALIST_SLOTS = Number(process.env.FINALIST_SLOTS) || 5;
const HOLDING = ['sent', 'accepted', 'completed'];
const NOT_DONE = ['declined', 'expired', 'failed'];
const REJECT_REASON = 'finalist_incomplete';
const OPEN_JOB = ['open', 'awaiting_outcome'];

const fail = (code, msg, extra) => Object.assign(new Error(msg || code), { code }, extra || {});
const published = (r) => r && r.status === 'completed' && (!r.held || r.reviewDecision === 'approved');
const nameOf = (c) => (c ? `${c.firstName} ${c.lastName || ''}`.trim() : 'A candidate');

// The combined CoderByte test for these 3 topics, or null.
async function assessmentFor(topics) {
  const all = await SkillAssessment.find({ active: true, kind: 'finalist' });
  return all.find((a) => topicsContent.matches(a, topics)) || null;
}

// Counts and holds. The slot count comes from the rows, so nothing is stored that could drift.
const slotsUsed = (jobId) => FinalistTest.countDocuments({ jobId, status: { $in: HOLDING } });
async function slots(posting) {
  const used = await slotsUsed(posting._id);
  return { used, left: Math.max(0, FINALIST_SLOTS - used), total: FINALIST_SLOTS };
}
const isLocked = async (posting) => !!(await FinalistTest.exists({ jobId: posting._id }));

// Topics are chosen once. Throws .code invalid | locked.
async function setTopics(posting, input) {
  const { topics, error } = topicsContent.validate(input);
  if (error || topics.length !== topicsContent.PICK) throw fail('invalid', error || `Choose exactly ${topicsContent.PICK} finalist topics.`);
  if (await isLocked(posting)) throw fail('locked', 'The finalist topics are locked once the first finalist test is sent.');
  posting.finalistTopics = topics;
  await posting.save();
  return topics;
}

async function setAutoReject(posting, on) {
  posting.finalistAutoReject = on === true;
  await posting.save();
  return posting.finalistAutoReject;
}

// What happens when a request ends without a score. Auto-reject only when the recruiter switched it on; otherwise
// the recruiter is told and decides. Never throws.
async function afterNotDone(r) {
  try {
    if (r.decision) return;
    const [posting, app, cand] = await Promise.all([JobPosting.findById(r.jobId), JobApplication.findById(r.applicationId), Candidate.findById(r.candidateId)]);
    if (!posting || !app || !ACTIVE.includes(app.status)) return;
    if (posting.finalistAutoReject) {
      const res = await jobApps.moveStage(app, posting, 'rejected', { reason: REJECT_REASON, finalistIncomplete: true });
      if (res.ok) { r.decision = 'rejected'; r.decidedAt = new Date(); r.decidedBy = 'auto'; await r.save(); return; }
    }
    await notify('recruiter', r.recruiterId, 'finalist_incomplete',
      `${nameOf(cand)} did not complete the finalist test for ${posting.title}. Choose whether to keep or reject them`.slice(0, 200),
      `/recruiter-jobs/${posting._id}/applicants`);
  } catch (e) { console.error('[finalistTests] follow-up failed:', e.message); }
}

// Closes requests nobody started, and accepted ones whose test link ran out. Safe to call any time.
async function expireOverdue(scope = {}, now = new Date()) {
  const sent = await FinalistTest.find({ ...scope, status: 'sent', expiresAt: { $lt: now } });
  for (const r of sent) { r.status = 'expired'; await r.save(); await afterNotDone(r); }
  const accepted = await FinalistTest.find({ ...scope, status: 'accepted' });
  for (const r of accepted) {
    const res = r.resultId ? await SkillResult.findById(r.resultId) : null;
    if (!res || res.status === 'failed' || (['invited', 'started'].includes(res.status) && res.expiresAt && res.expiresAt < now)) {
      r.status = 'expired'; await r.save(); await afterNotDone(r);
    }
  }
}

// Throws .code not_found | not_active | closed | no_topics | open | no_slots | no_test | manual | recent (with .until).
async function send(recruiter, posting, applicationId) {
  if (!/^[0-9a-f]{24}$/i.test(String(applicationId))) throw fail('not_found', 'Applicant not found');
  const app = await JobApplication.findOne({ _id: applicationId, jobId: posting._id });
  if (!app) throw fail('not_found', 'Applicant not found');
  if (!ACTIVE.includes(app.status)) throw fail('not_active', 'This applicant is no longer in play');
  if (!OPEN_JOB.includes(posting.status)) throw fail('closed', 'This posting is closed');
  if ((posting.finalistTopics || []).length !== topicsContent.PICK) throw fail('no_topics', 'Choose the finalist topics first');
  await expireOverdue({ jobId: posting._id });
  if (await FinalistTest.exists({ applicationId: app._id, status: { $in: HOLDING } })) throw fail('open', 'Already invited');
  if ((await slots(posting)).left < 1) throw fail('no_slots', 'No finalist slots left on this posting');
  const assessment = await assessmentFor(posting.finalistTopics);
  if (!assessment) throw fail('no_test', 'That finalist test is not available');
  const candidate = await Candidate.findById(app.candidateId);
  if (!candidate) throw fail('not_found', 'Applicant not found');
  const skills = require('./skills');
  if (await skills.manualHold(candidate._id, assessment)) throw fail('manual', 'Unavailable');
  const until = await skills.nextAllowed(candidate._id, assessment);
  if (until) throw fail('recent', 'Took this test recently', { until });

  // A new invite settles any earlier ended one for this applicant, so its keep-or-reject notice goes away.
  await FinalistTest.updateMany({ applicationId: app._id, status: { $in: NOT_DONE }, decision: null }, { $set: { decision: 'kept', decidedAt: new Date(), decidedBy: 'resent' } });

  const sentAt = new Date();
  const request = await FinalistTest.create({
    jobId: posting._id, applicationId: app._id, recruiterId: recruiter._id, candidateId: candidate._id,
    assessmentId: assessment.assessmentId, topics: posting.finalistTopics, sentAt, expiresAt: new Date(sentAt.getTime() + REQUEST_HOURS * HOUR),
  });
  try {
    const company = posting.hiringCompany || (recruiter.company && recruiter.company !== 'Not provided' ? recruiter.company : '');
    await require('./skillNotifications').deliver(candidate, 'finalist_invite', posting.title, company);
  } catch (e) { console.error('[finalistTests] candidate notice failed:', e.message); }
  return request;
}

// Invites waiting on this candidate (sent) or in progress (accepted), for their Skills page.
async function pendingFor(candidate) {
  await expireOverdue({ candidateId: candidate._id });
  const rows = await FinalistTest.find({ candidateId: candidate._id, status: { $in: ['sent', 'accepted'] } }).sort({ sentAt: -1 });
  const out = [];
  for (const r of rows) {
    const [posting, app] = await Promise.all([JobPosting.findById(r.jobId), JobApplication.findById(r.applicationId)]);
    if (!posting || !app || !ACTIVE.includes(app.status)) continue;
    out.push({ id: String(r._id), status: r.status, expiresAt: r.expiresAt, job: posting.title, company: posting.hiringCompany,
      topics: r.topics.map(topicsContent.label) });
  }
  return out;
}

async function ownRequest(candidate, id) {
  const r = await FinalistTest.findOne({ _id: id, candidateId: candidate._id }).catch(() => null);
  if (!r) throw fail('not_found', 'Invite not found');
  return r;
}

// Throws .code not_found | expired, plus startAttempt's own (retake_wait, manual, not_found).
async function accept(candidate, id) {
  const r = await ownRequest(candidate, id);
  await expireOverdue({ candidateId: candidate._id });
  const fresh = await FinalistTest.findById(r._id);
  if (!['sent', 'accepted'].includes(fresh.status)) throw fail('expired', 'This invite is no longer open');
  const app = await JobApplication.findById(fresh.applicationId);
  if (!app || !ACTIVE.includes(app.status)) throw fail('expired', 'This invite is no longer open');
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
  const fresh = await FinalistTest.findById(r._id);
  if (fresh.status !== 'sent') throw fail('expired', 'This invite is no longer open');
  fresh.status = 'declined';
  fresh.respondedAt = new Date();
  await fresh.save();
  await afterNotDone(fresh);
  return fresh;
}

// Called whenever an attempt's outcome changes (report stored, staff approve or reject). Idempotent.
// Published -> the request completes, the score is kept on it and the recruiter is told once.
// Rejected by the integrity review -> the slot comes back and the recruiter decides, as for a decline.
async function onResult(result) {
  const r = await FinalistTest.findOne({ resultId: result._id, status: 'accepted' });
  if (!r || result.status !== 'completed') return null;
  if (result.reviewDecision === 'rejected') { r.status = 'failed'; await r.save(); await afterNotDone(r); return r; }
  if (!published(result)) return r;   // held for review: the slot stays held, nobody is told yet
  r.status = 'completed';
  r.completedAt = result.completedAt || new Date();
  r.score = result.overallScore;
  r.topicScores = (result.skills || []).filter((s) => s.score != null).map((s) => ({ key: String(s.key).replace(/^finalist-/, ''), score: s.score }));
  const first = !r.recruiterNotified;
  r.recruiterNotified = true;
  await r.save();
  if (first) {
    const [posting, cand] = await Promise.all([JobPosting.findById(r.jobId), Candidate.findById(r.candidateId)]);
    await notify('recruiter', r.recruiterId, 'finalist_done',
      `${nameOf(cand)} finished the finalist test for ${posting ? posting.title : 'your job'}`.slice(0, 200), `/recruiter-jobs/${r.jobId}/applicants`);
  }
  return r;
}

// The recruiter's choice about someone who did not finish. Throws .code not_found | decided | not_active.
async function decide(posting, requestId, choice) {
  const r = await FinalistTest.findOne({ _id: requestId, jobId: posting._id }).catch(() => null);
  if (!r || !NOT_DONE.includes(r.status)) throw fail('not_found', 'Nothing to decide');
  if (r.decision) throw fail('decided', 'Already decided');
  if (choice === 'reject') {
    const app = await JobApplication.findById(r.applicationId);
    if (!app || !ACTIVE.includes(app.status)) throw fail('not_active', 'This applicant is no longer in play');
    const res = await jobApps.moveStage(app, posting, 'rejected', { reason: REJECT_REASON, finalistIncomplete: true });
    if (!res.ok) throw fail('not_active', res.error);
    r.decision = 'rejected';
  } else if (choice === 'keep') {
    r.decision = 'kept';
  } else throw fail('invalid', 'Choose keep or reject');
  r.decidedAt = new Date();
  r.decidedBy = 'recruiter';
  await r.save();
  return r;
}

// Everything the applicants page needs: per-applicant status, the slots and who is waiting on a decision.
async function overview(posting) {
  await expireOverdue({ jobId: posting._id });
  const rows = await FinalistTest.find({ jobId: posting._id }).sort({ sentAt: 1 });
  const latest = new Map();
  for (const r of rows) latest.set(String(r.applicationId), r);   // newest wins (sorted oldest first)
  const byApp = new Map();
  for (const [k, r] of latest) {
    byApp.set(k, { id: String(r._id), status: r.status, expiresAt: r.expiresAt, score: r.score, topicScores: r.topicScores || [],
      needsDecision: NOT_DONE.includes(r.status) && !r.decision, decision: r.decision, decidedBy: r.decidedBy });
  }
  return { slots: await slots(posting), topics: posting.finalistTopics || [], locked: rows.length > 0, byApp, hours: REQUEST_HOURS,
    autoReject: !!posting.finalistAutoReject, pickCount: topicsContent.PICK };
}

// What the applicants page shows if the finalist data cannot be loaded: no finalist stage, nothing broken.
const emptyOverview = (posting) => ({ slots: { used: 0, left: FINALIST_SLOTS, total: FINALIST_SLOTS }, topics: (posting && posting.finalistTopics) || [], locked: false,
  byApp: new Map(), hours: REQUEST_HOURS, autoReject: !!(posting && posting.finalistAutoReject), pickCount: topicsContent.PICK });

module.exports = { emptyOverview, FINALIST_SLOTS, REQUEST_HOURS, REJECT_REASON, HOLDING, NOT_DONE, assessmentFor, slots, isLocked, setTopics, setAutoReject,
  expireOverdue, send, pendingFor, accept, decline, onResult, decide, overview };
