// Role tests: one CoderByte role test per role and level (Junior, Mid-level, Senior). Built on demand.
// An Expert posting uses the Senior role test (plus the Expert skill exam); Entry level has no role test.
// If the test for a posting's role and level is not built yet, its applicants wait in the queue, staff are
// alerted, and applicants are told it will arrive within ROLE_TEST_PROMISE_DAYS business days. The moment the
// test is registered, releaseWaiting() tells them it is ready.
const SkillAssessment = require('../models/SkillAssessment');
const JobApplication = require('../models/JobApplication');
const { notify } = require('./notifications');
const Candidate = require('../models/Candidate');
const JobPosting = require('../models/JobPosting');

// Bell plus email to the candidate (skillNotifications.deliver). Never blocks the caller.
async function tell(candidateId, kind, name, extra) {
  try {
    const c = await Candidate.findById(candidateId);
    if (c) await require('./skillNotifications').deliver(c, kind, name, extra);
  } catch (e) { console.error('[roleTests] candidate notice failed:', e.message); }
}

const PROMISE_DAYS = () => Number(process.env.ROLE_TEST_PROMISE_DAYS) || 2;   // the single setting
const promiseText = () => `within ${PROMISE_DAYS()} business days`;
const LEVEL_FOR = { 'Entry level': null, Junior: 'Junior', 'Mid-level': 'Mid-level', Senior: 'Senior', Expert: 'Senior' };
const roleLevelFor = (seniorityLabel) => LEVEL_FOR[seniorityLabel] || null;

const findTest = (titleId, level) => (titleId && level
  ? SkillAssessment.findOne({ active: true, kind: 'title', roleKey: titleId, roleLevel: level }) : null);

const adminUrl = () => `https://${process.env.ADMIN_HOSTNAME || 'admin.precheckd.com'}/role-tests`;

async function alertStaff(posting, level) {
  try {
    const waiting = await JobApplication.countDocuments({ roleTestStatus: 'waiting', roleTestLevelKey: `${posting.titleId}|${level}` });
    await require('./emailService').sendStaffAlertEmail({
      subject: `Role test needed: ${posting.title} (${level})`,
      headline: 'A role test needs building',
      paragraphs: [
        `${waiting <= 1 ? 'The first applicant is' : `${waiting} applicants are`} waiting for the ${posting.title}: ${level} role test.`,
        `Applicants are told it will arrive ${promiseText()}.`
      ],
      buttonUrl: adminUrl(), buttonLabel: 'Open the queue'
    });
  } catch (e) { console.error('[roleTests] staff alert failed:', e.message); }
}

// Call right after an application is saved. Returns 'none' | 'ready' | 'waiting'.
async function onApplied(app, posting) {
  const level = roleLevelFor(posting.seniorityLabel);
  if (!level || posting.titleId === 'custom') return 'none';   // custom titles have no role test until staff add the role
  const test = await findTest(posting.titleId, level);
  app.roleTestLevelKey = `${posting.titleId}|${level}`;
  if (test) {
    app.roleTestStatus = 'ready'; app.roleTestAssessmentId = test.assessmentId; app.roleTestReadyAt = new Date();
    await app.save();
    await tell(app.candidateId, 'role_test_ready', test.name);
    return 'ready';
  }
  app.roleTestStatus = 'waiting';
  await app.save();
  await tell(app.candidateId, 'role_test_waiting', posting.title, promiseText());
  const first = (await JobApplication.countDocuments({ roleTestStatus: 'waiting', roleTestLevelKey: app.roleTestLevelKey })) === 1;
  if (first) await alertStaff(posting, level);   // one alert per role and level; the digest covers the rest
  return 'waiting';
}

// Flips every waiting applicant whose test now exists to ready and tells them. Safe to run any time.
async function releaseWaiting() {
  const waiting = await JobApplication.find({ roleTestStatus: 'waiting' });
  let n = 0;
  const cache = new Map();
  for (const app of waiting) {
    const key = app.roleTestLevelKey;
    if (!key) continue;
    if (!cache.has(key)) { const [id, lvl] = key.split('|'); cache.set(key, await findTest(id, lvl)); }
    const test = cache.get(key);
    if (!test) continue;
    app.roleTestStatus = 'ready'; app.roleTestAssessmentId = test.assessmentId; app.roleTestReadyAt = new Date();
    await app.save();
    await tell(app.candidateId, 'role_test_ready', test.name);
    n++;
  }
  return n;
}

// What is still waiting, grouped by role and level, oldest first.
async function queue() {
  const waiting = await JobApplication.find({ roleTestStatus: 'waiting' }).sort({ appliedAt: 1 });
  const groups = new Map();
  for (const a of waiting) {
    const g = groups.get(a.roleTestLevelKey) || { key: a.roleTestLevelKey, count: 0, oldest: a.appliedAt };
    g.count++; groups.set(a.roleTestLevelKey, g);
  }
  return [...groups.values()];
}

async function digest(now = Date.now()) {
  const q = await queue();
  if (!q.length) return 0;
  const { businessHoursSince } = require('../utils/businessTime');
  const rows = q.map((g) => `${g.key.replace('|', ': ')}: ${g.count} waiting, oldest ${Math.round(businessHoursSince(g.oldest, now))} business hours`);
  try {
    await require('./emailService').sendStaffAlertEmail({ subject: `${q.length} role test${q.length === 1 ? '' : 's'} waiting to be built`, headline: 'Role tests waiting to be built', paragraphs: rows, buttonUrl: adminUrl(), buttonLabel: 'Open the queue' });
  } catch (e) { console.error('[roleTests] digest failed:', e.message); }
  return q.length;
}

const ACTIVE = ['applied', 'screening', 'interviewing', 'offer'];
const published = (r) => r && r.status === 'completed' && (!r.held || r.reviewDecision === 'approved');

// The candidate's applications whose role test is ready to take (or in progress), for their Skills page.
async function pendingFor(candidate) {
  const apps = await JobApplication.find({ candidateId: candidate._id, roleTestStatus: 'ready', status: { $in: ACTIVE } });
  const out = [];
  for (const a of apps) {
    const [posting, test] = await Promise.all([JobPosting.findById(a.jobId), SkillAssessment.findOne({ assessmentId: a.roleTestAssessmentId })]);
    if (!posting) continue;
    out.push({ id: String(a._id), job: posting.title, company: posting.hiringCompany, test: (test && test.name) || posting.title, started: Boolean(a.roleTestResultId) });
  }
  return out;
}

// Starts (or resumes) the role test for one of the candidate's own applications. Throws .code not_found | not_ready,
// plus startAttempt's own (retake_wait, manual, locked, not_found).
async function start(candidate, applicationId) {
  const app = await JobApplication.findOne({ _id: applicationId, candidateId: candidate._id }).catch(() => null);
  if (!app || !ACTIVE.includes(app.status)) { const e = new Error('Not found'); e.code = 'not_found'; throw e; }
  if (app.roleTestStatus !== 'ready' || !app.roleTestAssessmentId) { const e = new Error('Not ready'); e.code = 'not_ready'; throw e; }
  const attempt = await require('./skills').startAttempt(candidate, app.roleTestAssessmentId);
  app.roleTestResultId = attempt._id;
  await app.save();
  return attempt;
}

// Called whenever an attempt's outcome changes. Published -> the score goes on the application and the recruiter is
// told once. Rejected (integrity check) -> the application goes back to "ready" so they can try again.
async function onResult(result) {
  const app = await JobApplication.findOne({ roleTestResultId: result._id });
  if (!app || result.status !== 'completed') return null;
  if (result.reviewDecision === 'rejected') { app.roleTestResultId = null; await app.save(); return app; }
  if (!published(result) || app.roleTestStatus === 'done') return app;
  app.roleTestResult = { score: result.overallScore, takenAt: result.completedAt || new Date() };
  app.roleTestStatus = 'done';
  await app.save();
  const posting = await JobPosting.findById(app.jobId);
  await notify('recruiter', app.recruiterId, 'role_test_done', `A role test score is in for ${posting ? posting.title : 'your job'}`.slice(0, 200), `/recruiter-jobs/${app.jobId}/applicants`);
  return app;
}

module.exports = { pendingFor, start, onResult, roleLevelFor, findTest, onApplied, releaseWaiting, queue, digest, promiseText, PROMISE_DAYS };
