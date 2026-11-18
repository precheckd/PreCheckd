// Run: node tests/finalist-tests.test.js
// Finalist (second-stage) tests: topics, slots, 72-hour clock, decline/expiry, keep-or-reject, auto-reject, results. Database stubbed.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const FinalistTest = require('../src/models/FinalistTest');
const JobApplication = require('../src/models/JobApplication');
const JobPosting = require('../src/models/JobPosting');
const Candidate = require('../src/models/Candidate');
const SkillAssessment = require('../src/models/SkillAssessment');
const SkillResult = require('../src/models/SkillResult');
const Notification = require('../src/models/Notification');
const skills = require('../src/services/skills');
const jobApps = require('../src/services/jobApplications');
const skillNotes = require('../src/services/skillNotifications');
const topics = require('../src/content/finalistTopics');

// ---- in-memory stubs -----------------------------------------------------------------------------
const rows = []; const apps = []; const results = []; const notes = []; const delivered = []; const moved = [];
const same = (a, b) => String(a) === String(b);
const test = (row, f) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.$in) return v.$in.map(String).includes(String(row[k]));
    if (v.$lt) return row[k] < v.$lt;
    if (v.$ne !== undefined) return !same(row[k], v.$ne);
  }
  return same(row[k], v) || (v === null && (row[k] === null || row[k] === undefined));
});
const q = (arr) => { const p = Promise.resolve(arr); p.sort = () => p; return p; };
let seq = 0;
const hex = (n) => String(n).padStart(24, '0');
const wrap = (d) => Object.assign(d, { save: async function () { if (!rows.includes(d)) rows.push(d); return d; } });
FinalistTest.create = async (d) => { const r = wrap({ _id: 'ft' + (++seq), status: 'sent', decision: null, decidedBy: null, recruiterNotified: false, topicScores: [], ...d }); rows.push(r); return r; };
FinalistTest.find = (f) => q(rows.filter((r) => test(r, f)));
FinalistTest.findOne = (f) => { const p = Promise.resolve(rows.find((r) => test(r, f)) || null); return p; };
FinalistTest.findById = async (id) => rows.find((r) => same(r._id, id)) || null;
FinalistTest.countDocuments = async (f) => rows.filter((r) => test(r, f)).length;
FinalistTest.exists = async (f) => (rows.some((r) => test(r, f)) ? { _id: 1 } : null);
FinalistTest.updateMany = async (f, u) => { rows.filter((r) => test(r, f)).forEach((r) => Object.assign(r, u.$set)); };
JobApplication.findOne = async (f) => apps.find((a) => test(a, f)) || null;
JobApplication.findById = async (id) => apps.find((a) => same(a._id, id)) || null;
const postings = [];
JobPosting.findById = async (id) => postings.find((p) => same(p._id, id)) || null;
Candidate.findById = async (id) => ({ _id: id, firstName: 'Pat' + id, lastName: 'L', email: 'p@x.com', slug: 'p' + id });
SkillAssessment.find = async () => assessments;
SkillResult.findById = async (id) => results.find((r) => same(r._id, id)) || null;
Notification.create = async (d) => { notes.push(d); return d; };
skillNotes.deliver = async (c, type, a, b) => { delivered.push({ c: c._id, type, a, b }); };
skills.manualHold = async () => false;
skills.nextAllowed = async () => null;
skills.startAttempt = async (c, id) => { const a = { _id: 'att' + (++seq), inviteUrl: 'https://cb.test/' + id }; results.push({ ...a, status: 'invited', expiresAt: new Date(Date.now() + 14 * 86400000) }); return a; };
jobApps.moveStage = async (app, posting, stage, opts) => { moved.push({ app: app._id, stage, opts }); app.status = stage; return { ok: true }; };
const ft = require('../src/services/finalistTests');

const combo = (...t) => ({ assessmentId: 'combo-' + t.join('-'), kind: 'finalist', active: true, skills: t.map((k) => ({ key: 'finalist-' + k, label: k })) });
const assessments = [combo('logic', 'problem', 'time'), combo('logic', 'detail', 'numbers')];
const mkPosting = (extra) => { const p = { _id: 'j' + (++seq), title: 'Support Engineer', hiringCompany: 'Acme', recruiterId: 'r1', status: 'open', finalistTopics: [], finalistAutoReject: false, save: async function () {}, ...extra }; postings.push(p); return p; };
const mkApp = (job, cid) => { const a = { _id: hex(++seq), jobId: job._id, candidateId: cid, recruiterId: 'r1', status: 'applied' }; apps.push(a); return a; };
const recruiter = { _id: 'r1', company: 'Agency' };
const reset = () => { rows.length = 0; apps.length = 0; results.length = 0; notes.length = 0; delivered.length = 0; moved.length = 0; postings.length = 0; };
const code = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };

let n = 0;
async function t(name, fn) { reset(); await fn(); n++; console.log('ok  ' + name); }

(async () => {
  await t('topics: none, or exactly 3 of the 5; junk is refused', async () => {
    assert.deepStrictEqual(topics.validate(undefined), { topics: [], error: null });
    assert.deepStrictEqual(topics.validate(['time', 'logic', 'problem']).topics, ['logic', 'problem', 'time']);
    assert.ok(topics.validate(['logic', 'time']).error);
    assert.ok(topics.validate(['logic', 'time', 'problem', 'detail']).error);
    assert.ok(topics.validate(['logic', 'time', 'cooking']).error);
    assert.strictEqual(topics.TOPICS.length, 5);
  });

  await t('the combo test is found by its three topics', async () => {
    assert.strictEqual((await ft.assessmentFor(['logic', 'problem', 'time'])).assessmentId, 'combo-logic-problem-time');
    assert.strictEqual((await ft.assessmentFor(['logic', 'numbers', 'detail'])).assessmentId, 'combo-logic-detail-numbers');
    assert.strictEqual(await ft.assessmentFor(['time', 'detail', 'numbers']), null);
  });

  await t('topics save once, then lock after the first invite', async () => {
    const p = mkPosting();
    assert.strictEqual(await code(() => ft.setTopics(p, ['logic'])), 'invalid');
    await ft.setTopics(p, ['logic', 'problem', 'time']);
    assert.deepStrictEqual(p.finalistTopics, ['logic', 'problem', 'time']);
    await ft.setTopics(p, ['logic', 'detail', 'numbers']);   // still allowed: nothing sent yet
    await ft.send(recruiter, p, mkApp(p, 'c1')._id);
    assert.strictEqual(await code(() => ft.setTopics(p, ['logic', 'problem', 'time'])), 'locked');
  });

  await t('sending: needs topics, an applicant in play, one invite each, and tells the candidate', async () => {
    const p = mkPosting(); const a = mkApp(p, 'c1');
    assert.strictEqual(await code(() => ft.send(recruiter, p, a._id)), 'no_topics');
    p.finalistTopics = ['logic', 'problem', 'time'];
    const r = await ft.send(recruiter, p, a._id);
    assert.strictEqual(r.status, 'sent');
    assert.ok(r.expiresAt - r.sentAt === 72 * 3600000);
    assert.deepStrictEqual(delivered.map((d) => d.type), ['finalist_invite']);
    assert.strictEqual(await code(() => ft.send(recruiter, p, a._id)), 'open');
    const gone = mkApp(p, 'c2'); gone.status = 'rejected';
    assert.strictEqual(await code(() => ft.send(recruiter, p, gone._id)), 'not_active');
    assert.strictEqual(await code(() => ft.send(recruiter, p, 'zzz')), 'not_found');
    p.status = 'closed'; const late = mkApp(p, 'c3');
    assert.strictEqual(await code(() => ft.send(recruiter, p, late._id)), 'closed');
  });

  await t('five slots per posting; a slot comes back when someone declines', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] });
    const list = [1, 2, 3, 4, 5, 6].map((i) => mkApp(p, 'c' + i));
    for (const a of list.slice(0, 5)) await ft.send(recruiter, p, a._id);
    assert.deepStrictEqual(await ft.slots(p), { used: 5, left: 0, total: 5 });
    assert.strictEqual(await code(() => ft.send(recruiter, p, list[5]._id)), 'no_slots');
    await ft.decline({ _id: 'c1', firstName: 'Pat' }, rows[0]._id);
    assert.strictEqual((await ft.slots(p)).left, 1);
    await ft.send(recruiter, p, list[5]._id);
    assert.strictEqual((await ft.slots(p)).left, 0);
  });

  await t('a candidate who took this test recently, or is on hold, cannot be sent it', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] }); const a = mkApp(p, 'c1');
    skills.nextAllowed = async () => new Date(Date.now() + 86400000);
    assert.strictEqual(await code(() => ft.send(recruiter, p, a._id)), 'recent');
    skills.nextAllowed = async () => null; skills.manualHold = async () => true;
    assert.strictEqual(await code(() => ft.send(recruiter, p, a._id)), 'manual');
    skills.manualHold = async () => false;
    assert.strictEqual((await ft.slots(p)).used, 0);
  });

  await t('decline: the recruiter is asked, nobody is rejected, nothing changes until they choose', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] }); const a = mkApp(p, 'c1');
    const r = await ft.send(recruiter, p, a._id);
    await ft.decline({ _id: 'c1', firstName: 'Pat' }, r._id);
    assert.strictEqual(r.status, 'declined');
    assert.strictEqual(a.status, 'applied'); assert.strictEqual(moved.length, 0);
    assert.ok(notes.some((x) => x.type === 'finalist_incomplete' && /keep or reject/.test(x.title)));
    const o = await ft.overview(p);
    assert.strictEqual(o.byApp.get(String(a._id)).needsDecision, true);
  });

  await t('keep leaves them in the pipeline; reject uses the fixed reason', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] });
    const a1 = mkApp(p, 'c1'); const a2 = mkApp(p, 'c2');
    const r1 = await ft.send(recruiter, p, a1._id); const r2 = await ft.send(recruiter, p, a2._id);
    await ft.decline({ _id: 'c1' }, r1._id); await ft.decline({ _id: 'c2' }, r2._id);
    await ft.decide(p, r1._id, 'keep');
    assert.strictEqual(a1.status, 'applied'); assert.strictEqual(r1.decision, 'kept'); assert.strictEqual(moved.length, 0);
    await ft.decide(p, r2._id, 'reject');
    assert.deepStrictEqual(moved[0], { app: a2._id, stage: 'rejected', opts: { reason: 'finalist_incomplete', finalistIncomplete: true } });
    assert.strictEqual(r2.decision, 'rejected'); assert.strictEqual(r2.decidedBy, 'recruiter');
    assert.strictEqual(await code(() => ft.decide(p, r2._id, 'keep')), 'decided');
    assert.strictEqual((await ft.overview(p)).byApp.get(String(a1._id)).needsDecision, false);
  });

  await t('auto-reject is OFF by default and only rejects when switched on', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] });
    assert.strictEqual(p.finalistAutoReject, false);
    const a = mkApp(p, 'c1'); const r = await ft.send(recruiter, p, a._id);
    await ft.decline({ _id: 'c1' }, r._id);
    assert.strictEqual(moved.length, 0);
    await ft.setAutoReject(p, true);
    const b = mkApp(p, 'c2'); const r2 = await ft.send(recruiter, p, b._id);
    await ft.decline({ _id: 'c2' }, r2._id);
    assert.strictEqual(moved.length, 1); assert.strictEqual(r2.decision, 'rejected'); assert.strictEqual(r2.decidedBy, 'auto');
  });

  await t('72 hours pass: the invite expires, the slot returns and the recruiter is asked', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] }); const a = mkApp(p, 'c1');
    const r = await ft.send(recruiter, p, a._id);
    r.expiresAt = new Date(Date.now() - 1000);
    await ft.expireOverdue({});
    assert.strictEqual(r.status, 'expired');
    assert.strictEqual((await ft.slots(p)).left, 5);
    assert.strictEqual(a.status, 'applied'); assert.strictEqual(moved.length, 0);
    assert.ok(notes.some((x) => x.type === 'finalist_incomplete'));
  });

  await t('sending again to someone who did not finish clears their old notice', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] }); const a = mkApp(p, 'c1');
    const r1 = await ft.send(recruiter, p, a._id);
    await ft.decline({ _id: 'c1' }, r1._id);
    const r2 = await ft.send(recruiter, p, a._id);
    assert.strictEqual(r1.decision, 'kept'); assert.strictEqual(r1.decidedBy, 'resent');
    const o = await ft.overview(p);
    assert.strictEqual(o.byApp.get(String(a._id)).id, String(r2._id)); assert.strictEqual(o.byApp.get(String(a._id)).needsDecision, false);
  });

  await t('accept starts the test; a published result completes it with the score and tells the recruiter once', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] }); const a = mkApp(p, 'c1');
    const r = await ft.send(recruiter, p, a._id);
    const attempt = await ft.accept({ _id: 'c1' }, r._id);
    assert.ok(/combo-logic-problem-time/.test(attempt.inviteUrl)); assert.strictEqual(r.status, 'accepted');
    const result = { _id: attempt._id, status: 'completed', held: false, overallScore: 83, completedAt: new Date(), skills: [{ key: 'finalist-logic', score: 90 }, { key: 'finalist-time', score: 70 }] };
    await ft.onResult(result); await ft.onResult(result);
    assert.strictEqual(r.status, 'completed'); assert.strictEqual(r.score, 83);
    assert.deepStrictEqual(r.topicScores, [{ key: 'logic', score: 90 }, { key: 'time', score: 70 }]);
    assert.strictEqual(notes.filter((x) => x.type === 'finalist_done').length, 1);
    assert.strictEqual((await ft.slots(p)).used, 1);
  });

  await t('held for review: nothing is shown yet; rejected by the review: slot returns and the recruiter decides', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] }); const a = mkApp(p, 'c1');
    const r = await ft.send(recruiter, p, a._id);
    const attempt = await ft.accept({ _id: 'c1' }, r._id);
    const result = { _id: attempt._id, status: 'completed', held: true, reviewDecision: null, overallScore: 98, completedAt: new Date(), skills: [] };
    await ft.onResult(result);
    assert.strictEqual(r.status, 'accepted'); assert.strictEqual(r.score === null || r.score === undefined, true);
    assert.strictEqual(notes.filter((x) => x.type === 'finalist_done').length, 0);
    result.reviewDecision = 'rejected';
    await ft.onResult(result);
    assert.strictEqual(r.status, 'failed'); assert.strictEqual((await ft.slots(p)).left, 5);
    assert.strictEqual(moved.length, 0);
  });

  await t('accepting a closed invite, or one for someone no longer in play, is refused', async () => {
    const p = mkPosting({ finalistTopics: ['logic', 'problem', 'time'] }); const a = mkApp(p, 'c1');
    const r = await ft.send(recruiter, p, a._id);
    a.status = 'rejected';
    assert.strictEqual(await code(() => ft.accept({ _id: 'c1' }, r._id)), 'expired');
    assert.strictEqual(await code(() => ft.accept({ _id: 'someone-else' }, r._id)), 'not_found');
    assert.deepStrictEqual(await ft.pendingFor({ _id: 'c1' }), []);
  });

  await t('the finalist-only rejection reason is never in the normal menus', async () => {
    const rr = require('../src/content/rejectionReasons');
    assert.ok(!rr.reasonsFor('applied').some((r) => r.code === 'finalist_incomplete'));
    assert.strictEqual(rr.allowedFor(rr.byCode('finalist_incomplete'), 'applied', {}), false);
    assert.strictEqual(rr.allowedFor(rr.byCode('finalist_incomplete'), 'applied', { finalistIncomplete: true }), true);
  });

  console.log(`\n${n} passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
