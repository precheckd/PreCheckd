// Role tests: one CoderByte role test per role and level (Junior, Mid-level, Senior). Built on demand.
// An Expert posting uses the Senior role test (plus the Expert skill exam); Entry level has no role test.
// If the test for a posting's role and level is not built yet, its applicants wait in the queue, staff are
// alerted, and applicants are told it will arrive within ROLE_TEST_PROMISE_DAYS business days. The moment the
// test is registered, releaseWaiting() tells them it is ready.
const SkillAssessment = require('../models/SkillAssessment');
const JobApplication = require('../models/JobApplication');
const { notify } = require('./notifications');

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
    await notify('candidate', app.candidateId, 'role_test_ready', `Your ${posting.title} test is ready`.slice(0, 200), `/jobs/${posting._id}`);
    return 'ready';
  }
  app.roleTestStatus = 'waiting';
  await app.save();
  await notify('candidate', app.candidateId, 'role_test_waiting', `Your ${posting.title} test will be sent ${promiseText()}`.slice(0, 200), `/jobs/${posting._id}`);
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
    await notify('candidate', app.candidateId, 'role_test_ready', `Your ${test.name} test is ready`.slice(0, 200), `/jobs/${app.jobId}`);
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

module.exports = { roleLevelFor, findTest, onApplied, releaseWaiting, queue, digest, promiseText, PROMISE_DAYS };
