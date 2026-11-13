// Run: node tests/role-tests.test.js
// Role-test lookup, the "not built yet" queue, the staff alert and the release step. Database stubbed.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const SkillAssessment = require('../src/models/SkillAssessment');
const JobApplication = require('../src/models/JobApplication');
const Notification = require('../src/models/Notification');
const email = require('../src/services/emailService');

const tests = []; const apps = []; const notes = []; const alerts = [];
SkillAssessment.findOne = async (f) => tests.find((t) => t.active && t.kind === f.kind && t.roleKey === f.roleKey && t.roleLevel === f.roleLevel) || null;
const match = (a, f) => Object.entries(f).every(([k, v]) => a[k] === v);
JobApplication.find = (f) => { const rows = apps.filter((a) => match(a, f)); const p = Promise.resolve(rows); p.sort = () => p; return p; };
JobApplication.countDocuments = async (f) => apps.filter((a) => match(a, f)).length;
Notification.create = async (d) => { notes.push(d); return d; };
email.sendStaffAlertEmail = async (a) => { alerts.push(a); };
const rt = require('../src/services/roleTests');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const mk = (id) => { const a = { candidateId: id, jobId: 'j1', roleTestStatus: 'none', appliedAt: new Date(), save: async () => { if (!apps.includes(a)) apps.push(a); } }; return a; };
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
  await t('digest lists what is waiting', async () => {
    const a = mk('c5'); await rt.onApplied(a, posting('Junior'));
    const before = alerts.length; assert.strictEqual(await rt.digest(), 1); assert.strictEqual(alerts.length, before + 1);
  });
  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
