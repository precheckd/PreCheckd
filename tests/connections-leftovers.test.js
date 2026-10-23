// Run: node tests/connections-leftovers.test.js
// End connection, the 30-day survey, sending a job to a connection, and the staff hire review.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.SESSION_SECRET = 'test-secret';
process.env.DISABLE_JOB_NOTICES = 'true'; // sweeps are called directly below; the automatic triggers stay off
process.env.APP_BASE_URL = 'https://precheckd.test';
process.env.OUTREACH_ENABLED = 'true';
process.env.MOCK_EMAIL = 'true';
process.env.OUTREACH_POSTAL_ADDRESS = '1 Test St, Testville';
const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const qs = require('qs');

const JobPosting = require('../src/models/JobPosting');
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
const ce = require('../src/services/connectionEnd');
const hireReview = require('../src/services/hireReview');
const Message = require('../src/models/Message');
const OutreachMessage = require('../src/models/OutreachMessage');
const OutreachBlock = require('../src/models/OutreachBlock');
const Suppression = require('../src/models/Suppression');
const MailAlias = require('../src/models/MailAlias');

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
const withSelect = (doc) => { const p = Promise.resolve(doc); p.select = async () => doc; return p; };
Recruiter.findById = () => withSelect(recruiterDoc);
const msgs = [];
Message.create = async (d) => { msgs.push(d); return d; };
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
app.use('/jobs', require('../src/routes/jobs'));
app.use('/connections', require('../src/routes/connections'));
app.use('/recruiter-jobs', require('../src/routes/recruiter-jobs'));
app.use((req, res) => res.status(404).send('nf'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('err'); });

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p, { redirect: 'manual' });
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs.stringify(body) });
  const asOwner = () => { session = { recruiterId: '507f1f77bcf86cd799439011' }; };
  const asCandidate = (c) => { session = { candidateId: String(c._id) }; };
  Candidate.findById = (id) => withSelect(candidates.find((c) => String(c._id) === String(id)) || null);
  const apply = async (c, job) => { asCandidate(c); await post(`/jobs/${job._id}/apply`); return apps.find((a) => String(a.candidateId) === String(c._id) && String(a.jobId) === String(job._id)); };
  const newConn = (c, extra = {}) => { const k = new ConnectionRequest({ candidateId: c._id, recruiterId: '507f1f77bcf86cd799439011', status: 'accepted', respondedAt: new Date(), fullAccessStatus: 'granted', ...extra }); conns.push(k); return k; };

  const job = makePosting();
  const ann = makeCandidate('Ann'); const bob = makeCandidate('Bob');

  await t('a candidate ends a connection: access stops, applications are withdrawn, the recruiter gets a neutral notice', async () => {
    const annApp = await apply(ann, job);
    const conn = conns.find((c) => String(c.candidateId) === String(ann._id));
    assert.strictEqual(conn.status, 'accepted');
    asCandidate(ann);
    const before = notes.length;
    const res = await post(`/connections/${conn._id}/end`, { reason: 'pushy' });
    assert.ok(res.headers.get('location').includes('ended=1'));
    assert.strictEqual(conn.status, 'ended');
    assert.strictEqual(conn.endedBy, 'candidate');
    assert.strictEqual(conn.endReason, 'pushy');
    assert.strictEqual(conn.fullAccessStatus, 'none');
    assert.strictEqual(annApp.status, 'withdrawn');
    const n = notes.slice(before).find((x) => x.ownerType === 'recruiter');
    assert.ok(n && n.title === 'A connection was ended.' && !n.title.includes('pushy'));
  });

  await t('a reason is required, "Other" needs a note, contact details are refused, and only a party can end it', async () => {
    const c = newConn(bob);
    asCandidate(bob);
    assert.ok(decodeURIComponent((await post(`/connections/${c._id}/end`, {})).headers.get('location')).includes('Choose a reason'));
    assert.strictEqual(c.status, 'accepted');
    asOwner();
    assert.ok(decodeURIComponent((await post(`/connections/${c._id}/end`, { reason: 'other' })).headers.get('location')).includes('few words'));
    assert.ok(decodeURIComponent((await post(`/connections/${c._id}/end`, { reason: 'not_a_fit', note: 'call me 555-123-4567' })).headers.get('location')).includes('endError'));
    asCandidate(makeCandidate('Eve'));
    assert.strictEqual((await post(`/connections/${c._id}/end`, { reason: 'pushy' })).status, 404);
    assert.strictEqual(c.status, 'accepted');
    // candidate reasons are not valid for the recruiter and vice versa
    asOwner();
    assert.ok(decodeURIComponent((await post(`/connections/${c._id}/end`, { reason: 'pushy' })).headers.get('location')).includes('Choose a reason'));
  });

  await t('a recruiter ending closes live applications neutrally and stops messaging', async () => {
    const c = conns.find((x) => String(x.candidateId) === String(bob._id));
    const bobApp = await apply(bob, job);
    asOwner();
    const res = await post(`/connections/${c._id}/end`, { reason: 'not_a_fit' });
    assert.ok(res.headers.get('location').includes('ended=1'));
    assert.strictEqual(c.status, 'ended');
    assert.strictEqual(bobApp.status, 'rejected');
    assert.strictEqual(bobApp.rejectionText, 'The recruiter ended this connection.');
    assert.strictEqual(trackers.find((x) => String(x._id) === String(bobApp.trackerId)).status, 'rejected');
    const conversation = require('../src/utils/conversation');
    assert.strictEqual(await conversation.loadConversationContext({ type: 'recruiter', id: '507f1f77bcf86cd799439011' }, String(c._id)), null);
    assert.strictEqual((await post(`/connections/${c._id}/end`, { reason: 'not_a_fit' })).headers.get('location').includes('endError'), true, 'already ended');
  });

  await t('safety reasons alert staff; a candidate who ended is not asked again', async () => {
    const cy = makeCandidate('Cy'); const c = newConn(cy);
    let alerts = 0;
    const r = await ce.endConnection(c, 'candidate', { reason: 'suspicious' }, { alert: async () => { alerts++; } });
    assert.strictEqual(r.ok, true); assert.strictEqual(alerts, 1);
    const d = newConn(makeCandidate('Dee')); alerts = 0;
    await ce.endConnection(d, 'candidate', { reason: 'not_interested' }, { alert: async () => { alerts++; } });
    assert.strictEqual(alerts, 0);
    ConnectionRequest.findOne = async (f) => conns.find((x) => matches(x, f)) || null;
    assert.strictEqual(await ce.endedByCandidate(cy._id, '507f1f77bcf86cd799439011'), true);
    assert.strictEqual(await ce.endedByCandidate(bob._id, '507f1f77bcf86cd799439011'), false, 'recruiter-ended does not block');
  });

  await t('the 30-day survey goes out once, only for accepted connections at 30 days', async () => {
    const eli = makeCandidate('Eli'); const old = newConn(eli, { respondedAt: new Date(Date.now() - 31 * day) });
    const fresh = newConn(makeCandidate('Fay'), { respondedAt: new Date(Date.now() - 5 * day) });
    const ended = newConn(makeCandidate('Gus'), { respondedAt: new Date(Date.now() - 40 * day), status: 'ended' });
    ConnectionRequest.find = (f) => Promise.resolve(conns.filter((x) => matches(x, f) && (!f.respondedAt || new Date(x.respondedAt) < new Date(f.respondedAt.$lt))));
    const before = notes.length;
    assert.strictEqual((await ce.sendDueSurveys()).sent, 1);
    assert.ok(old.surveySentAt instanceof Date);
    assert.strictEqual(fresh.surveySentAt, null); assert.strictEqual(ended.surveySentAt, null);
    assert.ok(notes.slice(before).some((x) => String(x.ownerId) === String(eli._id) && x.title.includes('quick question')));
    assert.strictEqual((await ce.sendDueSurveys()).sent, 0);
    global.__old = old; global.__eli = eli;
  });

  await t('the survey page is private to the candidate, validates, saves, and a bad answer alerts staff', async () => {
    const old = global.__old;
    asOwner();
    assert.strictEqual((await get(`/connections/${old._id}/survey`)).status, 404);
    asCandidate(global.__eli);
    const page = await (await get(`/connections/${old._id}/survey`)).text();
    assert.ok(page.includes('A quick question') && page.includes('never shown to the recruiter') === false);
    assert.strictEqual((await post(`/connections/${old._id}/survey`, { contacted: 'real_opening' })).status, 400);
    const ok = await post(`/connections/${old._id}/survey`, { contacted: 'real_opening', respectful: 'yes' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(old.survey.contacted, 'real_opening');
    assert.ok((await (await get(`/connections/${old._id}/survey`)).text()).includes('Thank you'));
    let alerts = 0;
    await ce.saveSurvey(newConn(makeCandidate('Hal')), { contacted: 'not_real', respectful: 'no', note: '' }, { alert: async () => { alerts++; } });
    await ce.saveSurvey(newConn(makeCandidate('Ivy')), { contacted: 'real_opening', respectful: 'yes', note: '' }, { alert: async () => { alerts++; } });
    assert.strictEqual(alerts, 1);
  });

  await t('a recruiter can send an open job to a connection, but not a closed job or a stranger', async () => {
    const cand = makeCandidate('Jo'); const c = newConn(cand);
    ConnectionRequest.findById = async (id) => conns.find((x) => String(x._id) === String(id)) || null;
    Recruiter.findById = () => withSelect(recruiterDoc);
    asOwner();
    const before = msgs.length;
    const res = await post(`/recruiter-jobs/${job._id}/send`, { connectionId: String(c._id) });
    assert.ok(res.headers.get('location').endsWith('?sent=1'));
    const m = msgs[msgs.length - 1];
    assert.strictEqual(msgs.length, before + 1);
    assert.ok(m.body.includes(`/jobs/${job._id}/`) && m.body.includes('Cloud Engineer') && String(m.recipientId) === String(cand._id));
    const stranger = await post(`/recruiter-jobs/${job._id}/send`, { connectionId: '507f1f77bcf86cd7994390ff' });
    assert.ok(decodeURIComponent(stranger.headers.get('location')).includes('Pick one of your connections'));
    const closed = makePosting({ status: 'closed' });
    assert.ok(decodeURIComponent((await post(`/recruiter-jobs/${closed._id}/send`, { connectionId: String(c._id) })).headers.get('location')).includes('closed'));
    asCandidate(cand);
    assert.notStrictEqual((await post(`/recruiter-jobs/${job._id}/send`, { connectionId: String(c._id) })).status, 200);
  });

  await t('staff hire review lists flagged and long-unanswered hires, and clearing removes the flag', async () => {
    postings.length = 0;
    const denied = makePosting({ title: 'Denied', status: 'closed', reviewFlag: 'hire_denied', outcome: { kind: 'hired_elsewhere', hires: [{ source: 'elsewhere', status: 'denied', sentAt: new Date() }] } });
    const stale = makePosting({ title: 'Stale', status: 'closed', outcome: { kind: 'hired_elsewhere', hires: [{ source: 'elsewhere', status: 'pending', sentAt: new Date(Date.now() - 9 * day) }] } });
    makePosting({ title: 'Fresh', status: 'closed', outcome: { kind: 'hired_elsewhere', hires: [{ source: 'elsewhere', status: 'pending', sentAt: new Date(Date.now() - 2 * day) }] } });
    makePosting({ title: 'Fine', status: 'closed', outcome: { kind: 'cancelled', reason: 'budget' } });
    const repost = makePosting({ title: 'Repost', reviewFlag: 'repost_after_cancel' });
    const rows = await hireReview.listHireReviews();
    assert.deepStrictEqual(rows.map((r) => r.title).sort(), ['Denied', 'Repost', 'Stale']);
    assert.strictEqual(await hireReview.clearFlag(denied._id), true);
    assert.strictEqual(denied.reviewFlag, null);
    assert.strictEqual((await hireReview.listHireReviews()).some((r) => r.title === 'Denied'), false, 'cleared means reviewed');
    assert.strictEqual(await hireReview.clearFlag(repost._id), true);
    assert.ok(!(await hireReview.listHireReviews()).some((r) => r.title === 'Repost'));
    void stale;
  });

  await t('an early recruiter ending gets a survey a few days later; a late ending does not', async () => {
    const earlyC = newConn(makeCandidate('Kit'), { respondedAt: new Date(Date.now() - 10 * day) });
    const lateC = newConn(makeCandidate('Lou'), { respondedAt: new Date(Date.now() - 60 * day) });
    await ce.endConnection(earlyC, 'recruiter', { reason: 'not_a_fit' }, { now: new Date(Date.now() - 4 * day) });
    await ce.endConnection(lateC, 'recruiter', { reason: 'not_a_fit' }, { now: new Date(Date.now() - 4 * day) });
    ConnectionRequest.find = (f) => Promise.resolve(conns.filter((x) => matches(x, f)));
    const freshEnd = newConn(makeCandidate('Mo'), { respondedAt: new Date(Date.now() - 5 * day) });
    await ce.endConnection(freshEnd, 'recruiter', { reason: 'not_a_fit' });
    const before = notes.length;
    await ce.sendDueSurveys();
    assert.ok(earlyC.surveySentAt instanceof Date, 'ended 4 days ago, 6 days after it began');
    assert.strictEqual(lateC.surveySentAt, null, 'ended long after it began');
    assert.strictEqual(freshEnd.surveySentAt, null, 'ended just now');
    assert.ok(notes.slice(before).some((x) => String(x.ownerId) === String(earlyC.candidateId)));
  });

  await t('a job can be emailed to a non-member through the outreach rules, with the posting link', async () => {
    const outbox = [];
    const origLog = console.log; console.log = (...a) => { if (String(a[0]).startsWith('[MOCK EMAIL]')) outbox.push(a.join(' ')); else origLog(...a); };
    const sent = [];
    OutreachMessage.find = async () => []; OutreachMessage.findOne = async (f) => sent.find((m) => m.toEmail === f.toEmail && m.status === 'sent') || null;
    OutreachMessage.countDocuments = async () => sent.filter((m) => m.status === 'sent').length;
    OutreachMessage.create = async (d) => { const m = { ...d, save: async function () { return this; } }; sent.push(m); return m; };
    OutreachBlock.findOne = async () => null; Suppression.findOne = async () => null;
    MailAlias.findOne = async () => ({ alias: 'pat-lee' });
    Recruiter.findById = () => withSelect({ ...recruiterDoc, company: 'Acme Staffing', slug: 'pat-lee' });
    const open = makePosting({ title: 'Network Engineer' });
    asOwner();
    let res = await post(`/recruiter-jobs/${open._id}/email`, { toEmail: 'new.person@example.org', toName: 'Sam Rivers' });
    assert.ok(res.headers.get('location').endsWith('?emailed=1'), res.headers.get('location'));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].templateKey, 'job');
    assert.strictEqual(sent[0].role, 'Network Engineer');
    assert.ok(outbox.length === 1 && outbox[0].includes('new.person@example.org'));
    // the same address again is refused (one per address per 30 days)
    res = await post(`/recruiter-jobs/${open._id}/email`, { toEmail: 'new.person@example.org' });
    assert.ok(decodeURIComponent(res.headers.get('location')).includes('already emailed'));
    // a closed job cannot be emailed
    const closed = makePosting({ status: 'closed' });
    res = await post(`/recruiter-jobs/${closed._id}/email`, { toEmail: 'other@example.org' });
    assert.ok(decodeURIComponent(res.headers.get('location')).includes('closed'));
    // the body carries the posting link; the general compose form cannot use this template without a posting
    const outreach = require('../src/services/outreach');
    const mail = outreach.buildEmail({ recruiter: { firstName: 'Pat', lastName: 'Lee', slug: 'pat-lee', company: 'Acme' }, template: outreach.TEMPLATES.job, first: 'Sam', role: 'Network Engineer', note: '', messageId: 'abc', jobUrl: 'https://precheckd.test/jobs/1/x' });
    assert.ok(mail.text.includes('https://precheckd.test/jobs/1/x') && mail.text.includes('Verified by PreCheckd'));
    const direct = await outreach.sendOutreach({ recruiter: { ...recruiterDoc }, alias: { alias: 'pat-lee' }, input: { toEmail: 'x@example.org', templateKey: 'job', role: 'Network Engineer', note: '' } });
    assert.strictEqual(direct.error, 'template');
    console.log = origLog;
  });

  server.close();
  console.log(`\n${n} connections-leftovers tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
