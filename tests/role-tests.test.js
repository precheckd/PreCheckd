// Run: node tests/role-tests.test.js
// Role-test lookup, the "not built yet" queue, the staff alert and the release step. Database stubbed.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const SkillAssessment = require('../src/models/SkillAssessment');
const JobApplication = require('../src/models/JobApplication');
const Notification = require('../src/models/Notification');
const email = require('../src/services/emailService');
const Candidate = require('../src/models/Candidate');
const JobPosting = require('../src/models/JobPosting');
const skills = require('../src/services/skills');
const delivered = [];
Candidate.findById = async (id) => ({ _id: id, email: null, firstName: 'Pat', slug: 'pat' });
JobPosting.findById = async () => ({ title: 'Software Engineer', hiringCompany: 'Acme' });
JobApplication.findOne = async (f) => apps.find((a) => (f._id === undefined || a._id === f._id) && (f.candidateId === undefined || a.candidateId === f.candidateId) && (f.roleTestResultId === undefined || String(a.roleTestResultId) === String(f.roleTestResultId))) || null;
SkillAssessment.findOne = ((orig) => async (f) => (f.assessmentId && !f.kind ? tests.find((t) => t.assessmentId === f.assessmentId) || null : orig(f)))(SkillAssessment.findOne);
skills.startAttempt = async (c, id) => ({ _id: 'att-' + c._id, inviteUrl: 'https://cb.test/' + id });

const tests = []; const apps = []; const notes = []; const alerts = [];
SkillAssessment.findOne = async (f) => tests.find((t) => t.active && t.kind === f.kind && t.roleKey === f.roleKey && t.roleLevel === f.roleLevel) || null;
const match = (a, f) => Object.entries(f).every(([k, v]) => (v && v.$in ? v.$in.includes(a[k]) : a[k] === v));
JobApplication.find = (f) => { const rows = apps.filter((a) => match(a, f)); const p = Promise.resolve(rows); p.sort = () => p; return p; };
JobApplication.countDocuments = async (f) => apps.filter((a) => match(a, f)).length;
Notification.create = async (d) => { notes.push(d); return d; };
email.sendStaffAlertEmail = async (a) => { alerts.push(a); };
const rt = require('../src/services/roleTests');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const mk = (id) => { const a = { _id: 'app-' + id, status: 'applied', recruiterId: 'r1', candidateId: id, jobId: 'j1', roleTestStatus: 'none', appliedAt: new Date(), save: async () => { if (!apps.includes(a)) apps.push(a); } }; return a; };
const posting = (label) => ({ _id: 'j1', title: 'Software Engineer', titleId: 'software-engineer-coding', seniorityLabel: label });

(async () => {
  await t('levels: Entry none, Expert uses the Senior test', () => {
    assert.strictEqual(rt.roleLevelFor('Entry level'), null);
    assert.strictEqual(rt.roleLevelFor('Junior'), 'Junior');
    assert.strictEqual(rt.roleLevelFor('Mid-level'), 'Mid-level');
    assert.strictEqual(rt.roleLevelFor('Senior'), 'Senior');
    assert.strictEqual(rt.roleLevelFor('Expert'), 'Senior');
  });
  await t('promise is one setting, default 2 business days', () => {
    assert.strictEqual(rt.promiseText(), 'within 2 business days');
    process.env.ROLE_TEST_PROMISE_DAYS = '3'; assert.strictEqual(rt.promiseText(), 'within 3 business days'); delete process.env.ROLE_TEST_PROMISE_DAYS;
  });
  await t('entry level: nothing queued', async () => {
    const a = mk('c0'); assert.strictEqual(await rt.onApplied(a, posting('Entry level')), 'none'); assert.strictEqual(alerts.length, 0);
  });
  await t('no test yet: waiting, applicant told, staff alerted once', async () => {
    const a = mk('c1'), b = mk('c2');
    assert.strictEqual(await rt.onApplied(a, posting('Mid-level')), 'waiting');
    assert.strictEqual(await rt.onApplied(b, posting('Mid-level')), 'waiting');
    assert.strictEqual(alerts.length, 1);
    assert.ok(/within 2 business days/.test(notes[0].title));
    assert.strictEqual((await rt.queue())[0].count, 2);
  });
  await t('registering the test releases waiting applicants and tells them', async () => {
    tests.push({ assessmentId: 'se-mid', name: 'Software Engineer (Coding): Mid', kind: 'title', roleKey: 'software-engineer-coding', roleLevel: 'Mid-level', active: true });
    const before = notes.length;
    assert.strictEqual(await rt.releaseWaiting(), 2);
    assert.strictEqual(notes.length, before + 2);
    assert.ok(apps.filter((x) => x.roleTestStatus === 'ready').length === 2);
    assert.strictEqual((await rt.queue()).length, 0);
  });
  await t('test already built: ready at once, Expert gets the Senior test', async () => {
    const a = mk('c3'); assert.strictEqual(await rt.onApplied(a, posting('Mid-level')), 'ready'); assert.strictEqual(a.roleTestAssessmentId, 'se-mid');
    tests.push({ assessmentId: 'se-sr', kind: 'title', roleKey: 'software-engineer-coding', roleLevel: 'Senior', active: true });
    const e = mk('c4'); assert.strictEqual(await rt.onApplied(e, posting('Expert')), 'ready'); assert.strictEqual(e.roleTestAssessmentId, 'se-sr');
  });
  await t('the candidate starts the test for their own application; a published result puts the score on it', async () => {
    const a = apps.find((x) => x.candidateId === 'c3');
    assert.strictEqual((await rt.pendingFor({ _id: 'c3' })).length, 1);
    const attempt = await rt.start({ _id: 'c3' }, a._id);
    assert.strictEqual(attempt.inviteUrl, 'https://cb.test/se-mid');
    await assert.rejects(() => rt.start({ _id: 'someone-else' }, a._id), (e) => e.code === 'not_found');
    const before = notes.length;
    await rt.onResult({ _id: 'att-c3', status: 'completed', held: true, overallScore: 78 });   // held for review: nothing yet
    assert.strictEqual(a.roleTestStatus, 'ready');
    await rt.onResult({ _id: 'att-c3', status: 'completed', held: false, overallScore: 78, completedAt: new Date() });
    assert.strictEqual(a.roleTestStatus, 'done'); assert.strictEqual(a.roleTestResult.score, 78);
    assert.strictEqual(notes.length, before + 1); assert.strictEqual(notes[notes.length - 1].ownerType, 'recruiter');
    await rt.onResult({ _id: 'att-c3', status: 'completed', held: false, overallScore: 78 });   // idempotent
    assert.strictEqual(notes.length, before + 1);
  });
  await t('a rejected attempt sends the application back to ready so they can retry', async () => {
    const a = apps.find((x) => x.candidateId === 'c4'); await rt.start({ _id: 'c4' }, a._id);
    await rt.onResult({ _id: 'att-c4', status: 'completed', reviewDecision: 'rejected' });
    assert.strictEqual(a.roleTestStatus, 'ready'); assert.strictEqual(a.roleTestResultId, null);
  });
  await t('digest lists what is waiting', async () => {
    const a = mk('c5'); await rt.onApplied(a, posting('Junior'));
    const before = alerts.length; assert.strictEqual(await rt.digest(), 1); assert.strictEqual(alerts.length, before + 1);
  });
  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
