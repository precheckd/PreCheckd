// Run: node tests/apply-flow.test.js
// Apply, withdraw, auto-connect, tracker sync, and what editing a posting does to applicants. Database stubbed.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.SESSION_SECRET = 'test-secret';
process.env.DISABLE_JOB_NOTICES = 'true';
const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const qs = require('qs');

const JobPosting = require('../src/models/JobPosting');
const JobApplication = require('../src/models/JobApplication');
const ConnectionRequest = require('../src/models/ConnectionRequest');
const TrackerApplication = require('../src/models/Application');
const Notification = require('../src/models/Notification');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const SkillResult = require('../src/models/SkillResult');
const SkillAssessment = require('../src/models/SkillAssessment');
const skills = require('../src/services/skills');
const pub = require('../src/services/publicJob');
require('../src/models/JobNotice').deleteOne = async () => ({});

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

// ---- a tiny in-memory stand-in for the database ----
function matches(doc, f) {
  return Object.entries(f || {}).every(([k, v]) => {
    const x = doc[k];
    if (v && typeof v === 'object' && v.$in) return v.$in.map(String).includes(String(x));
    return String(x) === String(v);
  });
}
function fake(Model, store) {
  const chain = (rows) => { const p = Promise.resolve(rows); p.populate = async () => rows.map((r) => ({ candidateId: candidates.find((c) => String(c._id) === String(r.candidateId)), appliedAt: r.appliedAt, status: r.status, connectionId: r.connectionId })); p.sort = () => chain(rows); return p; };
  Model.find = (f) => chain(store.filter((d) => matches(d, f)));
  Model.findOne = async (f) => store.find((d) => matches(d, f)) || null;
  Model.findById = async (id) => store.find((d) => String(d._id) === String(id)) || null;
  Model.countDocuments = async (f) => store.filter((d) => matches(d, f)).length;
  Object.defineProperty(Model.prototype, 'save', { configurable: true, writable: true, value: async function () {
    const bad = this.validateSync(); if (bad) throw bad;
    if (!store.includes(this)) store.push(this); return this; } });
}
const postings = [], apps = [], conns = [], trackers = [], notes = [], candidates = [];
fake(JobPosting, postings); fake(JobApplication, apps); fake(ConnectionRequest, conns); fake(TrackerApplication, trackers); fake(Candidate, candidates);
Notification.create = async (d) => { notes.push(d); return d; };
Recruiter.findById = async () => ({ _id: '507f1f77bcf86cd799439011', firstName: 'Pat', lastName: 'Lee', slug: 'pat-lee', isActive: true, isSuspended: false,
  accountTier: 'standard', isIdentityVerified: true, isPhoneVerified: true });
SkillAssessment.find = async () => [{ skills: [{ key: 'linux', label: 'Linux' }, { key: 'cloud', label: 'Cloud' }] }];
SkillResult.find = () => ({ select: async () => [], sort: async () => [] });
let myLevels = {};
skills.currentSkills = async (id) => (myLevels[String(id)] || []).map((s) => ({ ...s, takenAt: new Date() }));

const day = 86400000;
function makePosting(over = {}) {
  const p = new JobPosting({
    recruiterId: '507f1f77bcf86cd799439011', status: 'open', source: 'precheckd', nickname: 'x',
    titleId: 'cloud-engineer', title: 'Cloud Engineer', skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }],
    seniorityLabel: 'Mid-level', hiringCompany: 'Acme Corp', authorizedToRecruit: true, employmentType: 'full_time', openings: 1,
    arrangement: 'remote', relocation: false, travel: 'none', shift: 'daytime', basePayType: 'salary', baseMin: 100000, baseMax: 120000,
    payBasis: ['skill_level'], benefits: ['health'], goodFaithAt: new Date(), requirementsAttestedAt: new Date(),
    closeDate: new Date(Date.now() + 10 * day), startDate: new Date(Date.now() + 30 * day), startFirm: false,
    summary: 'Run our cloud platform with a small friendly team that ships every week.',
    responsibilities: ['Operate infrastructure', 'Improve pipelines', 'Respond to incidents'], createdAt: new Date(), ...over,
  });
  assert.strictEqual(p.validateSync(), undefined);
  postings.push(p);
  return p;
}
function makeCandidate(name, levelByKey = { linux: 'Advanced' }) {
  const c = new Candidate({ firstName: name, lastName: 'Test', slug: name.toLowerCase() + '-test', email: name + '@example.com', phone: '+15555550100',
    emailVerifiedAt: new Date(), isPhoneVerified: true, isIdentityVerified: true, shifts: ['daytime'] });
  candidates.push(c);
  myLevels[String(c._id)] = Object.entries(levelByKey).map(([key, level]) => ({ key, label: key, level }));
  return c;
}

// ---- app ----
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
app.use('/recruiter-jobs', require('../src/routes/recruiter-jobs'));
app.use((req, res) => res.status(404).send('nf'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('err'); });

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p, { redirect: 'manual' });
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs.stringify(body) });
  const asCandidate = (c) => { session = { candidateId: String(c._id) }; };
  const asOwner = () => { session = { recruiterId: '507f1f77bcf86cd799439011' }; };

  const job = makePosting();
  const jobPath = pub.pathOf(job);
  const ann = makeCandidate('Ann'); const bob = makeCandidate('Bob'); const cy = makeCandidate('Cy', { linux: 'Foundational' });

  await t('a qualified candidate sees Apply; an unqualified one sees what is missing', async () => {
    asCandidate(ann);
    let html = await (await get(jobPath)).text();
    assert.ok(html.includes('You meet every requirement') && html.includes(`/jobs/${job._id}/apply`));
    asCandidate(cy);
    html = await (await get(jobPath)).text();
    assert.ok(html.includes('You do not meet every requirement yet') && !html.includes(`href="/jobs/${job._id}/apply"`));
  });

  await t('the apply screen says plainly what applying does', async () => {
    asCandidate(ann);
    const html = await (await get(`/jobs/${job._id}/apply`)).text();
    assert.ok(html.includes('full profile, video and resume') && html.includes('$100,000 to $120,000 a year') && html.includes('Pat Lee'));
  });

  await t('an unqualified candidate cannot apply, even by posting directly', async () => {
    asCandidate(cy);
    assert.strictEqual((await get(`/jobs/${job._id}/apply`)).headers.get('location'), jobPath);
    const res = await post(`/jobs/${job._id}/apply`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(apps.length, 0);
  });

  await t('applying connects, shares the profile, fills the tracker and tells the recruiter', async () => {
    asCandidate(ann);
    const res = await post(`/jobs/${job._id}/apply`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), `${jobPath}?applied=1`);
    assert.strictEqual(apps.length, 1);
    assert.strictEqual(apps[0].status, 'applied');
    assert.strictEqual(conns.length, 1);
    assert.strictEqual(conns[0].status, 'accepted');
    assert.strictEqual(conns[0].fullAccessStatus, 'granted');
    assert.strictEqual(trackers.length, 1);
    assert.strictEqual(trackers[0].roleTitle, 'Cloud Engineer');
    assert.strictEqual(trackers[0].source, 'precheckd');
    assert.ok(notes.some((x) => x.ownerType === 'recruiter' && x.title.includes('New applicant')));
  });

  await t('applying twice does nothing new, and the page shows the application with a withdraw button', async () => {
    asCandidate(ann);
    await post(`/jobs/${job._id}/apply`);
    assert.strictEqual(apps.length, 1);
    const html = await (await get(`${jobPath}?applied=1`)).text();
    assert.ok(html.includes('You applied') && html.includes('Withdraw my application'));
  });

  await t('the recruiter sees the applicant with a link to the full profile', async () => {
    asOwner();
    const html = await (await get(`/recruiter-jobs/${job._id}/applicants`)).text();
    assert.ok(html.includes('Ann Test') && html.includes(`/recruiter-dashboard/requests/${conns[0]._id}/candidate`));
    const detail = await (await get(`/recruiter-jobs/${job._id}`)).text();
    assert.ok(detail.includes('Applicants (1)'));
  });

  await t('someone else\'s applicants page is not found', async () => {
    session = { recruiterId: '507f1f77bcf86cd799439099' };
    assert.strictEqual((await get(`/recruiter-jobs/${job._id}/applicants`)).status, 404);
  });

  await t('withdrawing stops the shared access, updates the tracker and tells the recruiter', async () => {
    asCandidate(ann);
    const res = await post(`/jobs/${job._id}/withdraw`);
    assert.strictEqual(res.headers.get('location'), `${jobPath}?withdrew=1`);
    assert.strictEqual(apps[0].status, 'withdrawn');
    assert.strictEqual(apps[0].withdrawnBy, 'candidate');
    assert.strictEqual(conns[0].fullAccessStatus, 'none');
    assert.strictEqual(conns[0].status, 'accepted'); // the connection stays
    assert.strictEqual(trackers[0].status, 'withdrawn');
    assert.ok(notes.some((x) => x.title.includes('withdrew')));
  });

  await t('applying again after withdrawing revives the same application', async () => {
    asCandidate(ann);
    await post(`/jobs/${job._id}/apply`);
    assert.strictEqual(apps.length, 1);
    assert.strictEqual(apps[0].status, 'applied');
    assert.strictEqual(apps[0].withdrawnBy, null);
    assert.strictEqual(conns[0].fullAccessStatus, 'granted');
    assert.strictEqual(trackers.length, 1);
  });

  await t('a closed job cannot be applied to', async () => {
    const old = makePosting({ status: 'closed', title: 'Old Role' });
    asCandidate(bob);
    await post(`/jobs/${old._id}/apply`);
    assert.strictEqual(apps.filter((a) => String(a.jobId) === String(old._id)).length, 0);
  });

  await t('a logged-out visitor is sent to log in and brought back to the job', async () => {
    session = {};
    const res = await get(`/jobs/${job._id}/start?to=login`);
    assert.strictEqual(res.headers.get('location'), '/login');
    assert.strictEqual(session.returnTo, jobPath);
    const apply = await get(`/jobs/${job._id}/apply`);
    assert.strictEqual(apply.headers.get('location'), '/login');
    const signup = await get(`/jobs/${job._id}/start?to=signup`);
    assert.strictEqual(signup.headers.get('location'), '/candidate-landing');
    assert.ok(require('../src/routes/auth').safeJobPath(jobPath));
    assert.strictEqual(require('../src/routes/auth').safeJobPath('//evil.com/jobs/x'), null);
    assert.strictEqual(require('../src/routes/auth').safeJobPath('https://evil.com'), null);
  });

  // ---- editing a posting that has applicants ----
  const ownerForm = (over = {}) => ({
    skills: [{ key: 'linux', minLevel: 'Intermediate' }, { key: '', minLevel: '' }, { key: '', minLevel: '' }],
    titleId: 'cloud-engineer', nickname: 'x', hiringCompany: 'Acme Corp', authorizedToRecruit: 'on',
    employmentType: 'full_time', openings: '1', arrangement: 'remote', relocation: 'no', travel: 'none', shift: 'daytime',
    basePayType: 'salary', baseMin: '100000', baseMax: '120000', payBasis: ['skill_level'], benefits: ['health'], goodFaith: 'on',
    education: '', certGroups: [['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']], clearance: '',
    closeDate: new Date(job.closeDate.getTime() - 4 * 3600000).toISOString().slice(0, 10), startDate: job.startDate.toISOString().slice(0, 10),
    summary: 'Run our cloud platform with a small friendly team that ships every week.',
    responsibilities: 'Operate infrastructure\nImprove pipelines\nRespond to incidents', team: '', growth: '', requirementsAttested: 'on', outcomeAck: 'on',
    ...over,
  });

  await t('a pay change withdraws no one and tells every current applicant', async () => {
    asOwner();
    const before = notes.length;
    const res = await post(`/recruiter-jobs/${job._id}/edit`, ownerForm({ baseMax: '124000' }));
    assert.strictEqual(res.status, 302, await res.clone().text());
    assert.strictEqual(apps[0].status, 'applied');
    const sent = notes.slice(before).filter((x) => x.ownerType === 'candidate');
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].title.includes('was updated') && sent[0].title.includes('pay'));
  });

  await t('the pop-up count: a tightened requirement is previewed, and saving needs confirmation', async () => {
    const tight = ownerForm({ skills: [{ key: 'linux', minLevel: 'Expert' }, { key: '', minLevel: '' }, { key: '', minLevel: '' }], baseMax: '124000' });
    const prev = await (await post(`/recruiter-jobs/${job._id}/edit/preview`, tight)).json();
    assert.deepStrictEqual(prev, { ok: true, withdraw: 1, notify: 0 });
    const res = await post(`/recruiter-jobs/${job._id}/edit`, tight);
    const html = await res.text();
    assert.strictEqual(res.status, 409);
    assert.ok(html.includes('1 applicant will be withdrawn') && html.includes('name="confirmWithdraw"'));
    assert.strictEqual(apps[0].status, 'applied');
    assert.strictEqual(job.skills[0].minLevel, 'Intermediate');
  });

  await t('once confirmed, the applicant is withdrawn with a message and the edit is saved', async () => {
    const before = notes.length;
    const tight = ownerForm({ skills: [{ key: 'linux', minLevel: 'Expert' }, { key: '', minLevel: '' }, { key: '', minLevel: '' }], baseMax: '124000', confirmWithdraw: 'on' });
    const res = await post(`/recruiter-jobs/${job._id}/edit`, tight);
    assert.strictEqual(res.status, 302, await res.clone().text());
    assert.ok(res.headers.get('location').includes('withdrawn=1'));
    assert.strictEqual(job.skills[0].minLevel, 'Expert');
    assert.strictEqual(apps[0].status, 'withdrawn');
    assert.strictEqual(apps[0].withdrawnBy, 'requirement_change');
    assert.ok(apps[0].withdrawnNote.includes('Master'), apps[0].withdrawnNote);
    assert.strictEqual(conns[0].fullAccessStatus, 'none');
    assert.strictEqual(trackers[0].status, 'withdrawn');
    const sent = notes.slice(before).filter((x) => x.ownerType === 'candidate');
    assert.ok(sent.some((x) => x.title.includes('withdrawn because its requirements changed')));
    // and the candidate sees why, with the way to fix it, on the job page
    asCandidate(ann);
    const html = await (await get(jobPath)).text();
    assert.ok(html.includes('withdrawn because the requirements for this job changed') && html.includes('Start this skill track'));
  });

  await t('loosening a requirement never withdraws anyone', async () => {
    asCandidate(bob);
    myLevels[String(bob._id)] = [{ key: 'linux', label: 'linux', level: 'Expert', takenAt: new Date() }];
    await post(`/jobs/${job._id}/apply`);
    assert.ok(apps.some((a) => String(a.candidateId) === String(bob._id) && a.status === 'applied'));
    asOwner();
    const loose = ownerForm({ skills: [{ key: 'linux', minLevel: 'Foundational' }, { key: '', minLevel: '' }, { key: '', minLevel: '' }], baseMax: '124000' });
    const prev = await (await post(`/recruiter-jobs/${job._id}/edit/preview`, loose)).json();
    assert.strictEqual(prev.withdraw, 0);
    assert.strictEqual(prev.notify, 1);
    assert.strictEqual((await post(`/recruiter-jobs/${job._id}/edit`, loose)).status, 302);
    assert.ok(apps.some((a) => String(a.candidateId) === String(bob._id) && a.status === 'applied'));
  });

  await t('an applicant who already failed something is not swept up by an unrelated edit', async () => {
    // Bob drops below the bar on his own (a skill lapses), then the recruiter fixes a typo in the description.
    myLevels[String(bob._id)] = [{ key: 'linux', label: 'linux', level: 'Developing', takenAt: new Date() }];
    asOwner();
    const edit = ownerForm({ skills: [{ key: 'linux', minLevel: 'Foundational' }, { key: '', minLevel: '' }, { key: '', minLevel: '' }], baseMax: '124000',
      summary: 'Run our cloud platform with a small friendly team that ships every single week.' });
    const prev = await (await post(`/recruiter-jobs/${job._id}/edit/preview`, edit)).json();
    assert.strictEqual(prev.withdraw, 0);
  });

  server.close();
  console.log(`\n${n} tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
