// Demo seed: the sample data is valid, entirely fictional, findable by recruiters, and the reset cannot touch real data.
const assert = require('assert');
const mongoose = require('mongoose');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

(async () => {
  process.env.DEMO_MODE = 'true';
  const { build } = require('../src/demo/seedData');
  const { assertDemoDatabase, run } = require('../src/demo/seed');
  const NOW = Date.UTC(2026, 10, 18, 12);
  const data = build(NOW);
  const oid = () => new mongoose.Types.ObjectId();

  await t('builds the expected amount of sample data', () => {
    assert.strictEqual(data.recruiters.length, 3); assert.strictEqual(data.candidates.length, 37);
    assert.strictEqual(data.postings.length, 9); assert(data.applications.length > 30); assert.strictEqual(data.connections.length, 3);
    assert(data.skillAssessments.length >= 15);
  });
  await t('everything is fictional: invalid emails, reserved 555-01xx phones, no duplicates', () => {
    const emails = [...data.recruiters.map((r) => r.email), ...data.candidates.map((c) => c.doc.email)];
    const phones = [...data.recruiters.map((r) => r.phone), ...data.candidates.map((c) => c.doc.phone)];
    const slugs = [...data.recruiters.map((r) => r.slug), ...data.candidates.map((c) => c.doc.slug)];
    emails.forEach((e) => assert(/@demo\.invalid$/.test(e), e));
    phones.forEach((p) => assert(/^\+1202555(01\d\d)$/.test(p), p));
    for (const list of [emails, phones, slugs]) assert.strictEqual(new Set(list).size, list.length);
    const refs = data.candidates.flatMap((c) => c.results.map((r) => r.inviteRef));
    assert.strictEqual(new Set(refs).size, refs.length);
  });
  await t('the two shared logins exist', () => {
    const demo = require('../src/config/demo');
    assert(data.recruiters.some((r) => r.email === demo.RECRUITER_EMAIL));
    assert(data.candidates.some((c) => c.doc.email === demo.CANDIDATE_EMAIL));
  });
  await t('every document passes the real model validation', () => {
    const M = (n) => require('../src/models/' + n);
    const bad = [];
    const check = (Model, doc, label) => { const e = new Model(doc).validateSync(); if (e) bad.push(label + ': ' + Object.values(e.errors).map((x) => x.message).join('; ')); };
    data.skillAssessments.forEach((d) => check(M('SkillAssessment'), d, 'assessment ' + d.assessmentId));
    data.recruiters.forEach((r) => { const { key, ...d } = r; check(M('Recruiter'), d, 'recruiter ' + key); });
    data.candidates.forEach((c) => { check(M('Candidate'), c.doc, 'candidate ' + c.doc.slug); c.results.forEach((x) => check(M('SkillResult'), { ...x, candidateId: oid() }, 'result ' + x.inviteRef)); });
    data.postings.forEach((p, i) => { const { recruiterKey, ...d } = p; check(M('JobPosting'), { ...d, recruiterId: oid() }, 'posting ' + i); });
    data.applications.forEach((a, i) => check(M('JobApplication'), { jobId: oid(), candidateId: oid(), recruiterId: oid(), status: a.status, appliedAt: a.appliedAt }, 'application ' + i));
    data.connections.forEach((c, i) => check(M('ConnectionRequest'), { candidateId: oid(), recruiterId: oid(), note: c.note, status: c.status, initiatedBy: 'recruiter' }, 'connection ' + i));
    assert.deepStrictEqual(bad, []);
  });
  await t('every sample candidate is findable in recruiter search', () => {
    const { candidateMeetsMatchingRequirements } = require('../src/utils/candidateMatchingRequirements');
    const Candidate = require('../src/models/Candidate');
    data.candidates.forEach((c) => assert(candidateMeetsMatchingRequirements(new Candidate(c.doc)), c.doc.slug));
  });
  await t('every candidate shows at least 2 skill levels and some show a hidden Developing result', () => {
    data.candidates.forEach((c) => assert(c.results.filter((r) => r.skills[0].level !== 'Developing').length >= 2, c.doc.slug));
    assert(data.candidates.some((c) => c.results.some((r) => r.skills[0].level === 'Developing')));
  });
  await t('postings are open and dated in the future, with skills that have sample tests', () => {
    const have = new Set(data.skillAssessments.flatMap((a) => a.skills.map((s) => s.key)));
    data.postings.forEach((p) => { assert(p.closeDate.getTime() > NOW && p.startDate.getTime() > NOW); p.skills.forEach((s) => assert(have.has(s.key), s.key)); assert(p.baseMax >= p.baseMin); });
  });
  await t('the data is the same each night apart from dates', () => {
    const again = build(NOW);
    assert.deepStrictEqual(again.candidates.map((c) => c.doc.slug), data.candidates.map((c) => c.doc.slug));
  });

  await t('the reset refuses a real database or a missing DEMO_MODE', () => {
    assert.throws(() => assertDemoDatabase('precheckd'), /does not look like the demo/);
    assert.throws(() => assertDemoDatabase('precheckd-staging'), /demo/);
    assert.throws(() => assertDemoDatabase('', {}), /DEMO_MODE/);
    assert.throws(() => assertDemoDatabase('precheckd-demo', { DEMO_MODE: 'false' }), /DEMO_MODE/);
    assertDemoDatabase('precheckd-demo', { DEMO_MODE: 'true' });
  });

  await t('run() wipes first, then loads everything in order (stubbed database)', async () => {
    const wiped = []; const created = {};
    Object.defineProperty(mongoose.connection, 'name', { value: 'precheckd-demo', configurable: true });
    Object.defineProperty(mongoose.connection, 'db', { configurable: true, value: {
      listCollections: () => ({ toArray: async () => [{ name: 'candidates' }, { name: 'sessions' }, { name: 'system.views' }] }),
      collection: (n) => ({ deleteMany: async () => { wiped.push(n); } }),
    } });
    const names = ['Candidate', 'Recruiter', 'SkillResult', 'JobPosting', 'JobApplication', 'ConnectionRequest', 'FinalistTest'];
    for (const n of names) { const M = require('../src/models/' + n); M.create = async (d) => { created[n] = (created[n] || 0) + 1; return { _id: oid(), ...d }; }; }
    require('../src/models/SkillAssessment').insertMany = async (d) => { created.SkillAssessment = d.length; };
    require('../src/services/skills').refreshSkillSummary = async () => {};
    const counts = await run(NOW);
    assert.deepStrictEqual(wiped, ['candidates', 'sessions']);
    assert.strictEqual(created.Candidate, 37); assert.strictEqual(created.Recruiter, 3); assert.strictEqual(created.JobPosting, 9);
    assert.strictEqual(created.ConnectionRequest, 3); assert.strictEqual(counts.candidates, 37);
    assert.strictEqual(created.FinalistTest, 3);
    assert.strictEqual(created.SkillResult, data.candidates.reduce((n, c) => n + c.results.length, 0));
  });
  await t('run() on a non-demo database wipes nothing', async () => {
    let wiped = false;
    Object.defineProperty(mongoose.connection, 'name', { value: 'precheckd', configurable: true });
    Object.defineProperty(mongoose.connection, 'db', { configurable: true, value: { listCollections: () => ({ toArray: async () => { wiped = true; return []; } }), collection: () => ({ deleteMany: async () => { wiped = true; } }) } });
    await assert.rejects(() => run(NOW), /does not look like the demo/);
    assert.strictEqual(wiped, false);
  });

  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
