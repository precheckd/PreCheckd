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
const postings = [];
JobPosting.findById = async (id) => postings.find((p) => p._id === id) || null;
JobPosting.find = () => { const rows = postings.filter((p) => p.customTestRequestedAt && !p.customTestAssessmentId); const pr = Promise.resolve(rows); pr.sort = () => pr; return pr; };
JobApplication.findOne = async (f) => apps.find((a) => (f._id === undefined || a._id === f._id) && (f.candidateId === undefined || a.candidateId === f.candidateId) && (f.roleTestResultId === undefined || String(a.roleTestResultId) === String(f.roleTestResultId))) || null;
SkillAssessment.findOne = ((orig) => async (f) => (f.assessmentId && !f.kind ? tests.find((t) => t.assessmentId === f.assessmentId) || null : orig(f)))(SkillAssessment.findOne);
skills.startAttempt = async (c, id) => ({ _id: 'att-' + c._id, inviteUrl: 'https://cb.test/' + id });

const tests = []; const apps = []; const notes = []; const alerts = [];
SkillAssessment.findOne = async (f) => tests.find((t) => t.active && t.kind === f.kind && (f.assessmentId ? t.assessmentId === f.assessmentId : t.roleKey === f.roleKey && t.roleLevel === f.roleLevel)) || null;
SkillAssessment.findOneAndUpdate = async (f, u) => { const t = { ...u.$set, active: true }; tests.push(t); return t; };
const match = (a, f) => Object.entries(f).every(([k, v]) => (v && v.$in ? v.$in.includes(a[k]) : a[k] === v));
JobApplication.find = (f) => { const rows = apps.filter((a) => match(a, f)); const p = Promise.resolve(rows); p.sort = () => p; return p; };
JobApplication.countDocuments = async (f) => apps.filter((a) => match(a, f)).length;
Notification.create = async (d) => { notes.push(d); return d; };
email.sendStaffAlertEmail = async (a) => { alerts.push(a); };
const rt = require('../src/services/roleTests');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const mk = (id) => { const a = { _id: 'app-' + id, status: 'applied', recruiterId: 'r1', candidateId: id, jobId: 'j1', roleTestStatus: 'none', appliedAt: new Date(), save: async () => { if (!apps.includes(a)) apps.push(a); } }; return a; };
const posting = (label, id = 'j1') => {
  let p = postings.find((x) => x._id === id);
  if (!p) { p = { _id: id, title: 'Software Engineer', hiringCompany: 'Acme', recruiterId: 'r1', titleId: 'software-engineer-coding', skills: [{ label: 'Git', minLevel: 'Intermediate' }], summary: 'Build things.', responsibilities: ['Ship code'], customTestAssessmentId: null, customTestRequestedAt: null, save: async () => {} }; postings.push(p); }
  p.seniorityLabel = label; return p;
};

(async () => {
  await t('promise is one setting, default 2 business days', () => {
    assert.strictEqual(rt.promiseText(), 'within 2 business days');
    process.env.ROLE_TEST_PROMISE_DAYS = '3'; assert.strictEqual(rt.promiseText(), 'within 3 business days'); delete process.env.ROLE_TEST_PROMISE_DAYS;
  });
  await t('entry level: one general test for every role, queued until it exists, then sent at once', async () => {
    const a = mk('c0'); a.jobId = 'e1'; assert.strictEqual(await rt.onApplied(a, posting('Entry level', 'e1')), 'waiting');
    assert.strictEqual(a.roleTestLevelKey, 'entry-level'); assert.strictEqual(alerts.length, 1);
    tests.push({ assessmentId: 'entry-gen', name: 'Entry Level (General)', kind: 'title', roleKey: 'entry-level', roleLevel: 'Entry', active: true });
    assert.strictEqual(await rt.releaseWaiting(), 1); assert.strictEqual(a.roleTestAssessmentId, 'entry-gen');
    const other = mk('c0b'); other.jobId = 'e2';
    assert.strictEqual(await rt.onApplied(other, posting('Entry level', 'e2')), 'ready');
    apps.length = 0; alerts.length = 0; notes.length = 0; tests.length = 0; postings.length = 0;
  });
  await t('going live flags the posting once and alerts staff with the description ready', async () => {
    const p = posting('Mid-level');
    assert.strictEqual(await rt.requestForPosting(p), true); assert.strictEqual(await rt.requestForPosting(p), false);
    assert.strictEqual(alerts.length, 1); assert.ok(/Custom test needed/.test(alerts[0].subject));
    assert.ok(/\/custom-tests$/.test(alerts[0].buttonUrl));
    const d = rt.descriptionFor(p); assert.ok(d.includes('Software Engineer at Acme') && d.includes('- Ship code') && d.includes('- Git (Intermediate level or above)'));
    assert.strictEqual(await rt.requestForPosting(posting('Entry level', 'e9')), false);
  });
  await t('applicants before the test exists wait and are told; the alert is not repeated', async () => {
    const a = mk('c1'), b = mk('c2');
    assert.strictEqual(await rt.onApplied(a, posting('Mid-level')), 'waiting');
    assert.strictEqual(await rt.onApplied(b, posting('Mid-level')), 'waiting');
    assert.strictEqual(alerts.length, 1);
    assert.ok(/within 2 business days/.test(notes[0].title));
    const q = await rt.customQueue(); assert.strictEqual(q.length, 1); assert.strictEqual(q[0].waiting, 2);
    assert.strictEqual(a.roleTestLevelKey, 'posting:j1');
  });
  await t('parseTestRef takes an id or a link', () => {
    assert.strictEqual(rt.parseTestRef('technical-assessment-abc123xyz'), 'technical-assessment-abc123xyz');
    assert.strictEqual(rt.parseTestRef('https://coderbyte.com/assessment/technical-assessment-abc123xyz?x=1'), 'technical-assessment-abc123xyz');
    assert.strictEqual(rt.parseTestRef('https://coderbyte.com/sl-candidate?promo=precheckd-offr5:software-engineer-r6fiquec3e&invb=userwg0rltjoz'), 'software-engineer-r6fiquec3e');
    assert.strictEqual(rt.parseTestRef('https://coderbyte.com/report/user5hwqmw4zm:software-engineer-r6fiquec3e'), 'software-engineer-r6fiquec3e');
    assert.strictEqual(rt.parseTestRef('software-engineer-r6fiquec3e'), 'software-engineer-r6fiquec3e');
    assert.strictEqual(rt.parseTestRef('  '), null);
  });
  await t('saving the custom test releases the waiting applicants, tells them and the recruiter', async () => {
    await assert.rejects(() => rt.attach(posting('Mid-level'), 'technical-assessment-nope1234', { lookup: async () => null }), (e) => e.code === 'not_found');
    const before = notes.length;
    const out = await rt.attach(posting('Mid-level'), 'technical-assessment-custom01', { lookup: async () => ({ name: 'Software Engineer at Acme', public_url: 'https://cb/x' }) });
    assert.strictEqual(out.released, 2);
    assert.strictEqual(notes.length, before + 3);   // two candidates + the recruiter
    assert.ok(apps.every((x) => x.roleTestStatus === 'ready' && x.roleTestAssessmentId === 'technical-assessment-custom01'));
    assert.strictEqual((await rt.customQueue()).length, 0);
  });
  await t('attach reads the CoderByte list in the same shape the seed script does', async () => {
    const cb = require('../src/services/coderbyte'); const orig = cb.api;
    cb.api = async () => ({ data: { assessments: [{ test_id: 'software-engineer-zz11aa22bb', name: 'X', public_url: 'https://cb/y' }] } });
    try { const out = await rt.attach(posting('Mid-level'), 'software-engineer-zz11aa22bb'); assert.strictEqual(out.id, 'software-engineer-zz11aa22bb'); } finally { cb.api = orig; }
    posting('Mid-level').customTestAssessmentId = 'technical-assessment-custom01';
  });
  await t('test already attached: ready at once', async () => {
    const a = mk('c3'); assert.strictEqual(await rt.onApplied(a, posting('Expert')), 'ready'); assert.strictEqual(a.roleTestAssessmentId, 'technical-assessment-custom01');
  });
  await t('the candidate starts the test for their own application; a published result puts the score on it', async () => {
    const a = apps.find((x) => x.candidateId === 'c3');
    assert.strictEqual((await rt.pendingFor({ _id: 'c3' })).length, 1);
    const attempt = await rt.start({ _id: 'c3' }, a._id);
    assert.strictEqual(attempt.inviteUrl, 'https://cb.test/technical-assessment-custom01');
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
    const e4 = mk('c4'); e4.roleTestStatus = 'ready'; e4.roleTestAssessmentId = 'technical-assessment-custom01'; apps.push(e4);
    const a = e4; await rt.start({ _id: 'c4' }, a._id);
    await rt.onResult({ _id: 'att-c4', status: 'completed', reviewDecision: 'rejected' });
    assert.strictEqual(a.roleTestStatus, 'ready'); assert.strictEqual(a.roleTestResultId, null);
  });
  await t('digest lists what is waiting', async () => {
    const a = mk('c5'); a.jobId = 'j7'; await rt.onApplied(a, posting('Junior', 'j7')); await rt.requestForPosting(posting('Junior', 'j7'));
    const before = alerts.length; assert.strictEqual(await rt.digest(), 1); assert.strictEqual(alerts.length, before + 1);
  });
  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
