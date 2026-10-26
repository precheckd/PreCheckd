// Run: node tests/outcome-gate.test.js
// Close date, the outcome gate, recording how a job ended, hire confirmation, reminders and the repost flag.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.SESSION_SECRET = 'test-secret';
process.env.DISABLE_JOB_NOTICES = 'true'; // sweeps are called directly below; the automatic triggers stay off
process.env.APP_BASE_URL = 'https://precheckd.test';
const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const qs = require('qs');

const JobPosting = require('../src/models/JobPosting');
const JobDraft = require('../src/models/JobDraft');
JobDraft.find = () => { const p = Promise.resolve([]); p.sort = async () => []; return p; };
const JobApplication = require('../src/models/JobApplication');
const JobNotice = require('../src/models/JobNotice');
const ConnectionRequest = require('../src/models/ConnectionRequest');
const TrackerApplication = require('../src/models/Application');
const Notification = require('../src/models/Notification');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const SkillResult = require('../src/models/SkillResult');
const SkillAssessment = require('../src/models/SkillAssessment');
const skills = require('../src/services/skills');
const pub = require('../src/services/publicJob');
const jobMatches = require('../src/services/jobMatches');
const outcome = require('../src/services/postingOutcome');
const { runOutcomeReminders } = require('../src/services/outcomeReminders');
const { outcomeGate, isExempt } = require('../src/middleware/outcomeGate');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

function matches(doc, f) {
  return Object.entries(f || {}).every(([k, v]) => {
    const x = doc[k];
    if (k === 'outcome.hires.tokenHash') return ((doc.outcome && doc.outcome.hires) || []).some((h) => h.tokenHash === v);
    if (v && typeof v === 'object' && v.$in) return v.$in.map(String).includes(String(x));
    if (v && typeof v === 'object' && '$lt' in v) return new Date(x).getTime() < new Date(v.$lt).getTime();
    if (v && typeof v === 'object' && '$gt' in v) return new Date(x).getTime() > new Date(v.$gt).getTime();
    if (v && typeof v === 'object' && '$ne' in v) return String(x) !== String(v.$ne);
    return String(x) === String(v);
  });
}
function fake(Model, store) {
  const chain = (rows) => { const p = Promise.resolve(rows); p.sort = async () => rows; p.populate = async () => rows.map((r) => ({ candidateId: candidates.find((c) => String(c._id) === String(r.candidateId)), appliedAt: r.appliedAt, status: r.status, connectionId: r.connectionId, _id: r._id })); return p; };
  Model.updateMany = async (f, set) => { const rows = store.filter((d) => matches(d, f)); rows.forEach((d) => Object.assign(d, set)); return { modifiedCount: rows.length }; };
  Model.find = (f) => chain(store.filter((d) => matches(d, f)));
  Model.findOne = async (f) => store.find((d) => matches(d, f)) || null;
  Model.findById = async (id) => store.find((d) => String(d._id) === String(id)) || null;
  Model.countDocuments = async (f) => store.filter((d) => matches(d, f)).length;
  Object.defineProperty(Model.prototype, 'save', { configurable: true, writable: true, value: async function () {
    const bad = this.validateSync(); if (bad) throw bad;
    if (!store.includes(this)) store.push(this); return this; } });
}
const postings = [], apps = [], conns = [], trackers = [], notes = [], candidates = [], jobNotices = [];
fake(JobPosting, postings); fake(JobApplication, apps); fake(ConnectionRequest, conns); fake(TrackerApplication, trackers); fake(Candidate, candidates);
JobNotice.find = async (f) => jobNotices.filter((d) => matches(d, f));
JobNotice.findOne = async (f) => jobNotices.find((d) => matches(d, f)) || null;
JobNotice.deleteOne = async (f) => { const i = jobNotices.findIndex((d) => matches(d, f)); if (i >= 0) jobNotices.splice(i, 1); };
JobNotice.create = async (d) => {
  if (jobNotices.some((x) => String(x.candidateId) === String(d.candidateId) && String(x.jobId) === String(d.jobId))) throw new Error('E11000 duplicate');
  jobNotices.push(d); return d;
};
Notification.create = async (d) => { notes.push(d); return d; };
const recruiterDoc = { _id: '507f1f77bcf86cd799439011', firstName: 'Pat', lastName: 'Lee', slug: 'pat-lee', email: 'pat@acme.test', isActive: true, isSuspended: false,
  accountTier: 'standard', isIdentityVerified: true, isPhoneVerified: true, applicantDigestOptOut: false, lastApplicantDigestAt: null, save: async function () { return this; } };
Recruiter.findById = async () => recruiterDoc;
SkillAssessment.find = async () => [{ skills: [{ key: 'linux', label: 'Linux' }] }];
SkillResult.find = () => ({ select: async () => [], sort: async () => [] });
const levels = {};
skills.currentSkills = async (id) => (levels[String(id)] || []).map((s) => ({ ...s, takenAt: new Date() }));

const day = 86400000;
function makePosting(over = {}) {
  const p = new JobPosting({
    recruiterId: '507f1f77bcf86cd799439011', status: 'open', source: 'precheckd', nickname: 'x', titleId: 'cloud-engineer', title: 'Cloud Engineer',
    skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }], seniorityLabel: 'Mid-level', hiringCompany: 'Acme <Corp>', authorizedToRecruit: true,
    employmentType: 'full_time', openings: 1, arrangement: 'remote', relocation: false, travel: 'none', shift: 'daytime', basePayType: 'salary',
    baseMin: 100000, baseMax: 120000, payBasis: ['skill_level'], benefits: ['health'], goodFaithAt: new Date(), requirementsAttestedAt: new Date(),
    closeDate: new Date(Date.now() + 10 * day), startDate: new Date(Date.now() + 30 * day), startFirm: false,
    summary: 'Run our cloud platform with a small friendly team that ships every week.',
    responsibilities: ['Operate infrastructure', 'Improve pipelines', 'Respond to incidents'], createdAt: new Date(), ...over,
  });
  assert.strictEqual(p.validateSync(), undefined);
  postings.push(p); return p;
}
function makeCandidate(name, level = 'Advanced', extra = {}) {
  const c = new Candidate({ firstName: name, lastName: 'Test', slug: name.toLowerCase() + '-test', email: name + '@example.com', phone: '+15555550100',
    emailVerifiedAt: new Date(), isPhoneVerified: true, isIdentityVerified: true, shifts: ['daytime'], ...extra });
  candidates.push(c);
  if (level) levels[String(c._id)] = [{ key: 'linux', label: 'Linux', level }];
  return c;
}
const notesFor = (c) => notes.filter((x) => x.ownerType === 'candidate' && String(x.ownerId) === String(c._id));

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.locals.stripePublishableKey = 'pk_test';
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.use(express.urlencoded({ extended: true }));
let session = {};
app.use((req, res, next) => { req.session = session; res.locals.isAdminHost = false; next(); });
app.use(outcomeGate());
app.use('/jobs', require('../src/routes/jobs'));
app.use('/hire-confirm', require('../src/routes/hire-confirm'));
app.use('/recruiter-jobs', require('../src/routes/recruiter-jobs'));
app.use((req, res) => res.status(404).send('nf'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('err'); });

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, h = {}) => fetch(base + p, { redirect: 'manual', headers: h });
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs.stringify(body) });
  const asOwner = () => { session = { recruiterId: '507f1f77bcf86cd799439011' }; };
  const asCandidate = (c) => { session = { candidateId: String(c._id) }; };
  const apply = async (c, job) => { asCandidate(c); await post(`/jobs/${job._id}/apply`); return apps.find((a) => String(a.candidateId) === String(c._id) && String(a.jobId) === String(job._id)); };

  await t('expired open postings become awaiting outcome; others are left alone', async () => {
    const past = makePosting({ closeDate: new Date(Date.now() - day) });
    const future = makePosting();
    const done = makePosting({ status: 'closed', closeDate: new Date(Date.now() - day) });
    await outcome.closeExpired();
    assert.strictEqual(past.status, 'awaiting_outcome');
    assert.ok(past.awaitingOutcomeAt instanceof Date);
    assert.strictEqual(future.status, 'open');
    assert.strictEqual(done.status, 'closed');
  });

  await t('the exempt list lets log out, terms, privacy, billing, hire links and the outcome form through', async () => {
    for (const p of ['/logout', '/terms', '/privacy', '/billing/cancel', '/hire-confirm/abc', '/webhooks/stripe', '/css/app.css', '/js/x.js', '/recruiter-jobs/507f1f77bcf86cd799439012/outcome']) assert.ok(isExempt(p), p);
    for (const p of ['/', '/recruiter-jobs', '/recruiter-jobs/new', '/connections', '/search', '/mail', '/jobs']) assert.ok(!isExempt(p), p);
  });

  await t('a recruiter who owes an outcome is sent to the form from every other page; candidates are not', async () => {
    asOwner();
    const owed = postings.find((p) => p.status === 'awaiting_outcome');
    for (const p of ['/recruiter-jobs', '/recruiter-jobs/new', '/jobs']) {
      const r = await get(p);
      assert.strictEqual(r.status, 302, p);
      assert.strictEqual(r.headers.get('location'), `/recruiter-jobs/${owed._id}/outcome`);
    }
    const j = await get('/recruiter-jobs', { accept: 'application/json' });
    assert.strictEqual(j.status, 423);
    assert.strictEqual((await get(`/recruiter-jobs/${owed._id}/outcome`)).status, 200);
    session = {};
    assert.notStrictEqual((await get('/jobs')).status, 302);
    asCandidate(makeCandidate('Zed', null));
    assert.notStrictEqual((await get('/jobs')).status, 302);
  });

  await t('the gate catches a posting whose close date just passed, without waiting for the hourly job', async () => {
    postings.forEach((p) => { if (p.status === 'awaiting_outcome') p.status = 'closed'; });
    const soon = makePosting({ closeDate: new Date(Date.now() - 1000) });
    asOwner();
    const r = await get('/recruiter-jobs');
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.get('location').endsWith('/outcome'));
    assert.strictEqual(soon.status, 'awaiting_outcome');
    soon.status = 'closed';
  });

  await t('outcome validation: kind, hires, reasons and a note for Other', async () => {
    const job = makePosting();
    const ctx = { posting: job, liveIds: ['a1', 'a2'] };
    const v = (b) => outcome.validateOutcome(b, ctx).errors;
    assert.ok(v({}).kind);
    assert.ok(v({ kind: 'hired_precheckd' }).hiredIds);
    assert.ok(v({ kind: 'hired_precheckd', hiredIds: ['zzz'] }).hiredIds);
    assert.ok(v({ kind: 'hired_precheckd', hiredIds: ['a1', 'a2'] }).hiredIds, 'one opening only');
    assert.deepStrictEqual(v({ kind: 'hired_precheckd', hiredIds: ['a1'] }), {});
    assert.ok(v({ kind: 'hired_elsewhere', hireName: 'J', hireEmail: 'j@acme.com' }).hireName);
    assert.ok(v({ kind: 'hired_elsewhere', hireName: 'Jo Lee', hireEmail: 'jo@gmail.com' }).hireEmail);
    assert.ok(v({ kind: 'hired_elsewhere', hireName: 'Jo Lee', hireEmail: 'nonsense' }).hireEmail);
    assert.deepStrictEqual(v({ kind: 'hired_elsewhere', hireName: 'Jo Lee', hireEmail: 'jo@acme-corp.com' }), {});
    assert.ok(v({ kind: 'cancelled' }).reason);
    assert.ok(v({ kind: 'cancelled', reason: 'filled_internally_lol' }).reason);
    assert.ok(v({ kind: 'cancelled', reason: 'other' }).reasonNote);
    assert.ok(v({ kind: 'not_filled', reason: 'client_cancelled' }).reason, 'cancel reasons are not valid for not filled');
    assert.deepStrictEqual(v({ kind: 'not_filled', reason: 'other', reasonNote: 'Hiring manager left' }), {});
    assert.ok(v({ kind: 'not_filled', reason: 'other', reasonNote: 'call me at 555-123-4567 or me@x.com' }).reasonNote);
  });

  // ===== recording an outcome through the form =====
  const job1 = makePosting({ title: 'Cloud Engineer' });
  const ann = makeCandidate('Ann'); const bob = makeCandidate('Bob'); const cy = makeCandidate('Cy');
  const annApp = await apply(ann, job1); const bobApp = await apply(bob, job1); const cyApp = await apply(cy, job1);
  job1.closeDate = new Date(Date.now() - day); job1.status = 'awaiting_outcome';

  await t('the form lists who is still in the process; a bad answer shows errors and changes nothing', async () => {
    asOwner();
    const pr = await get(`/recruiter-jobs/${job1._id}/outcome`); const page = await pr.text(); if (!page.includes('Ann')) console.log(pr.status, page.slice(0, 300));
    assert.ok(page.includes('How did this job end?') && page.includes('Ann') && page.includes('Bob'));
    assert.ok(page.includes('Your account is paused'));
    const bad = await post(`/recruiter-jobs/${job1._id}/outcome`, { kind: 'cancelled' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(job1.status, 'awaiting_outcome');
  });

  await t('hiring through PreCheckd marks the hire, tells everyone else the job is filled, and ends their access', async () => {
    asOwner();
    const before = notes.length;
    const res = await post(`/recruiter-jobs/${job1._id}/outcome`, { kind: 'hired_precheckd', hiredIds: [String(annApp._id)] });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(job1.status, 'closed');
    assert.strictEqual(job1.outcome.kind, 'hired_precheckd');
    assert.strictEqual(job1.outcome.hires[0].source, 'precheckd');
    assert.strictEqual(annApp.status, 'hired');
    for (const a of [bobApp, cyApp]) {
      assert.strictEqual(a.status, 'rejected');
      assert.strictEqual(a.rejectionText, 'The position has been filled.');
      assert.strictEqual(a.rejectionReason, 'posting_closed');
      assert.strictEqual(trackers.find((x) => String(x._id) === String(a.trackerId)).status, 'rejected');
    }
    assert.ok(notes.slice(before).some((x) => String(x.ownerId) === String(bob._id) && x.title.includes('has closed')));
    asOwner();
    assert.strictEqual((await get('/recruiter-jobs')).status, 200, 'gate lifts once the outcome is recorded');
  });

  await t('cancelling needs a reason and tells applicants neutrally; the recruiter\'s other jobs are untouched', async () => {
    const job2 = makePosting({ title: 'Linux Admin' });
    const dee = makeCandidate('Dee'); const deeApp = await apply(dee, job2);
    asOwner();
    assert.strictEqual((await post(`/recruiter-jobs/${job2._id}/outcome`, { kind: 'cancelled' })).status, 400);
    const res = await post(`/recruiter-jobs/${job2._id}/outcome`, { kind: 'cancelled', reason: 'budget' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(job2.status, 'closed');
    assert.strictEqual(job2.outcome.reason, 'budget');
    assert.strictEqual(deeApp.rejectionText, 'The position was cancelled.');
    assert.ok(!deeApp.rejectionText.includes('budget'), 'the reason stays private');
    assert.strictEqual((await get(`/recruiter-jobs/${job2._id}/outcome`)).status, 302, 'a closed job has no form');
  });

  await t('hired elsewhere: the token is stored hashed and the confirmation email goes to the work address', async () => {
    const job3 = makePosting({ title: 'Network Engineer' });
    let mail = null;
    const r = await outcome.recordOutcome(job3, { kind: 'hired_elsewhere', hireName: 'Jo Lee', hireEmail: 'jo@acme-corp.com', reasonNote: '' }, { sendHireEmail: async (m) => { mail = m; } });
    assert.strictEqual(job3.status, 'closed');
    const hire = job3.outcome.hires[0];
    assert.strictEqual(hire.status, 'pending');
    assert.ok(mail && mail.to === 'jo@acme-corp.com' && mail.url.includes('/hire-confirm/'));
    const token = mail.url.split('/hire-confirm/')[1];
    assert.notStrictEqual(hire.tokenHash, token);
    assert.strictEqual(hire.tokenHash, outcome.hash(token));
    global.__tok = token; global.__job3 = job3;
  });

  await t('the hire-confirm page asks the question without naming anyone, and a yes confirms', async () => {
    const page = await get(`/hire-confirm/${global.__tok}`);
    const html = await page.text();
    assert.strictEqual(page.status, 200);
    assert.ok(html.includes('Network Engineer') && !html.includes('Jo Lee') && !html.includes('pat@acme'));
    const res = await post(`/hire-confirm/${global.__tok}`, { answer: 'yes' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(global.__job3.outcome.hires[0].status, 'confirmed');
    assert.ok((await (await get(`/hire-confirm/${global.__tok}`)).text()).includes('Thank you'));
    assert.strictEqual((await get('/hire-confirm/nope')).status, 404);
  });

  await t('a denial flags the posting and alerts staff; an old link expires', async () => {
    const mk = async (title) => {
      const p = makePosting({ title }); let mail;
      await outcome.recordOutcome(p, { kind: 'hired_elsewhere', hireName: 'Al Kim', hireEmail: 'al@acme-corp.com' }, { sendHireEmail: async (m) => { mail = m; } });
      return { p, token: mail.url.split('/hire-confirm/')[1] };
    };
    const a = await mk('A'); let alerted = 0;
    const r = await outcome.answerHireConfirmation(a.token, 'no', { alert: async () => { alerted++; } });
    assert.strictEqual(r.status, 'denied');
    assert.strictEqual(a.p.reviewFlag, 'hire_denied');
    assert.strictEqual(alerted, 1);
    const b = await mk('B');
    const late = await outcome.answerHireConfirmation(b.token, 'yes', { now: new Date(Date.now() + 31 * day) });
    assert.strictEqual(late.status, 'expired');
    assert.strictEqual(b.p.outcome.hires[0].status, 'expired');
  });

  await t('reminders: 3 days, then 1 day, each once; daily once paused; only in the morning window', async () => {
    postings.length = 0;
    const p = makePosting({ closeDate: new Date(Date.now() + 2.5 * day) });
    const sent = []; const send = async (r, post, info) => { sent.push(info.kind + ':' + (info.daysLeft || '')); };
    const morning = (offsetDays) => { const d = new Date(Date.now() + offsetDays * day); d.setUTCHours(13, 0, 0, 0); return d; }; // 8-9am ET
    const night = new Date(); night.setUTCHours(3, 0, 0, 0);
    assert.strictEqual((await runOutcomeReminders({ now: night, send })).outsideWindow, true);
    assert.strictEqual(sent.length, 0);
    let now = morning(0); p.closeDate = new Date(now.getTime() + 2.5 * day);
    await runOutcomeReminders({ now, send });
    await runOutcomeReminders({ now, send });
    assert.deepStrictEqual(sent, ['upcoming:3']);
    now = new Date(now.getTime() + 2 * day);
    await runOutcomeReminders({ now, send });
    assert.deepStrictEqual(sent, ['upcoming:3', 'upcoming:1']);
    now = new Date(now.getTime() + 1 * day);
    await runOutcomeReminders({ now, send });
    assert.strictEqual(p.status, 'awaiting_outcome');
    assert.strictEqual(sent[2], 'overdue:');
    await runOutcomeReminders({ now, send });
    assert.strictEqual(sent.length, 3, 'not twice in one day');
    await runOutcomeReminders({ now: new Date(now.getTime() + day), send });
    assert.strictEqual(sent.length, 4);
  });

  await t('reposting the same title within 30 days of a cancellation is flagged for review', async () => {
    postings.length = 0;
    const old = makePosting({ titleId: 'cloud-engineer', status: 'closed', closedAt: new Date(Date.now() - 10 * day), outcome: { kind: 'cancelled', reason: 'budget' } });
    const fresh = makePosting({ titleId: 'cloud-engineer' });
    const other = makePosting({ titleId: 'network-engineer' });
    let alerted = 0; const alert = async () => { alerted++; };
    assert.strictEqual(await outcome.flagRepost(fresh, { alert }), true);
    assert.strictEqual(fresh.reviewFlag, 'repost_after_cancel');
    assert.strictEqual(alerted, 1);
    assert.strictEqual(await outcome.flagRepost(other, { alert }), false);
    old.closedAt = new Date(Date.now() - 40 * day);
    fresh.reviewFlag = null;
    assert.strictEqual(await outcome.flagRepost(fresh, { alert }), false);
  });

  server.close();
  console.log(`\n${n} outcome-gate tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
