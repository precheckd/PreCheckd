// Run: node tests/pipeline-notices.test.js
// Pipeline stages, rejection reasons, "you qualify" notices, the Monday jobs list and the recruiter's daily email.
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
const { weeklyJobsSection } = require('../src/services/emailService');
const { runApplicantDigest, inWindow } = require('../src/services/applicantDigest');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

function matches(doc, f) {
  return Object.entries(f || {}).every(([k, v]) => {
    const x = doc[k];
    if (v && typeof v === 'object' && v.$in) return v.$in.map(String).includes(String(x));
    if (v && typeof v === 'object' && '$gt' in v) return new Date(x).getTime() > new Date(v.$gt).getTime();
    if (v && typeof v === 'object' && '$ne' in v) return String(x) !== String(v.$ne);
    return String(x) === String(v);
  });
}
function fake(Model, store) {
  const chain = (rows) => { const p = Promise.resolve(rows); p.populate = async () => rows.map((r) => ({ candidateId: candidates.find((c) => String(c._id) === String(r.candidateId)), appliedAt: r.appliedAt, status: r.status, connectionId: r.connectionId, _id: r._id })); return p; };
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
app.use('/jobs', require('../src/routes/jobs'));
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

  // ===== pipeline =====
  const job = makePosting();
  const ann = makeCandidate('Ann'); const bob = makeCandidate('Bob');
  for (const c of [ann, bob]) { asCandidate(c); await post(`/jobs/${job._id}/apply`); }
  const annApp = apps.find((a) => String(a.candidateId) === String(ann._id));
  const bobApp = apps.find((a) => String(a.candidateId) === String(bob._id));

  await t('a recruiter moves an applicant along the pipeline; the candidate is told and the tracker follows', async () => {
    asOwner();
    const before = notes.length;
    const res = await post(`/recruiter-jobs/${job._id}/applicants/${annApp._id}/stage`, { stage: 'screening' });
    assert.ok(res.headers.get('location').endsWith('?moved=1'));
    assert.strictEqual(annApp.status, 'screening');
    assert.ok(notes.slice(before).some((x) => x.title.includes('moved to Screening')));
    const tracker = trackers.find((x) => String(x._id) === String(annApp.trackerId));
    assert.strictEqual(tracker.status, 'screening');
    await post(`/recruiter-jobs/${job._id}/applicants/${annApp._id}/stage`, { stage: 'interviewing' });
    assert.strictEqual(tracker.status, 'interviewing');
  });

  await t('not moving forward needs a reason from the fixed list', async () => {
    asOwner();
    let res = await post(`/recruiter-jobs/${job._id}/applicants/${bobApp._id}/stage`, { stage: 'rejected' });
    assert.ok(decodeURIComponent(res.headers.get('location')).includes('Choose a reason'));
    res = await post(`/recruiter-jobs/${job._id}/applicants/${bobApp._id}/stage`, { stage: 'rejected', reason: 'made-up' });
    assert.ok(decodeURIComponent(res.headers.get('location')).includes('Choose a reason'));
    assert.strictEqual(bobApp.status, 'applied');
  });

  await t('a rejection shows the candidate only the neutral sentence, stops the access, keeps the connection', async () => {
    asOwner();
    const before = notes.length;
    await post(`/recruiter-jobs/${job._id}/applicants/${bobApp._id}/stage`, { stage: 'rejected', reason: 'not_a_fit' });
    assert.strictEqual(bobApp.status, 'rejected');
    assert.strictEqual(bobApp.rejectionReason, 'not_a_fit');
    const conn = conns.find((c) => String(c._id) === String(bobApp.connectionId));
    assert.strictEqual(conn.fullAccessStatus, 'none');
    assert.strictEqual(conn.status, 'accepted');
    const bell = notes.slice(before).find((x) => x.ownerType === 'candidate');
    assert.ok(bell.title.includes('moving forward with other candidates') && !bell.title.toLowerCase().includes('fit'));
    asCandidate(bob);
    const html = await (await get(pub.pathOf(job))).text();
    assert.ok(html.includes('Not moving forward') && html.includes('moving forward with other candidates'));
    assert.ok(!html.includes('not_a_fit') && !html.includes('right fit for the team'));
    assert.ok(!html.includes('Withdraw my application') && !html.includes(`/jobs/${job._id}/apply"`));
  });

  await t('a rejected applicant cannot apply again', async () => {
    asCandidate(bob);
    await post(`/jobs/${job._id}/apply`);
    assert.strictEqual(apps.filter((a) => String(a.candidateId) === String(bob._id)).length, 1);
    assert.strictEqual(bobApp.status, 'rejected');
  });

  await t('rejected and hired are final; hired tells the candidate', async () => {
    asOwner();
    let res = await post(`/recruiter-jobs/${job._id}/applicants/${bobApp._id}/stage`, { stage: 'screening' });
    assert.ok(decodeURIComponent(res.headers.get('location')).includes('can no longer be moved'));
    const before = notes.length;
    await post(`/recruiter-jobs/${job._id}/applicants/${annApp._id}/stage`, { stage: 'hired' });
    assert.strictEqual(annApp.status, 'hired');
    assert.ok(notes.slice(before).some((x) => x.title.includes('Congratulations')));
    res = await post(`/recruiter-jobs/${job._id}/applicants/${annApp._id}/stage`, { stage: 'offer' });
    assert.ok(decodeURIComponent(res.headers.get('location')).includes('can no longer be moved'));
  });

  await t('only the posting\'s owner can move applicants', async () => {
    session = { recruiterId: '507f1f77bcf86cd799439099' };
    assert.strictEqual((await post(`/recruiter-jobs/${job._id}/applicants/${annApp._id}/stage`, { stage: 'offer' })).status, 404);
    asOwner();
    assert.strictEqual((await post(`/recruiter-jobs/${job._id}/applicants/507f1f77bcf86cd7994399aa/stage`, { stage: 'offer' })).status, 404);
  });

  await t('the applicants page shows finished applicants without move controls or a profile link', async () => {
    asOwner();
    const html = await (await get(`/recruiter-jobs/${job._id}/applicants`)).text();
    assert.ok(html.includes('Hired') && html.includes('Not moving forward'));
    assert.ok(!html.includes('name="stage"') && !html.includes('View profile')); // both are finished: no controls, access closed
  });

  // ===== "you qualify" notices =====
  postings.length = 0; apps.length = 0; notes.length = 0; jobNotices.length = 0; candidates.length = 0;
  const open = makePosting({ title: 'Linux Admin' });
  const good = makeCandidate('Gus', 'Advanced');
  const weak = makeCandidate('Wes', 'Foundational');
  const hidden = makeCandidate('Hal', 'Advanced', { openToOpportunities: false });
  const unverified = makeCandidate('Una', 'Advanced', { isIdentityVerified: false });

  await t('a new job is announced to verified, open candidates who meet every requirement, and no one else', async () => {
    const count = await jobMatches.sweepPosting(open);
    assert.strictEqual(count, 1);
    assert.strictEqual(notesFor(good).length, 1);
    assert.ok(notesFor(good)[0].title.includes('You qualify for Linux Admin') && notesFor(good)[0].url === pub.pathOf(open));
    for (const c of [weak, hidden, unverified]) assert.strictEqual(notesFor(c).length, 0);
  });

  await t('each job is announced once however often we look', async () => {
    assert.strictEqual(await jobMatches.sweepPosting(open), 0);
    assert.strictEqual(await jobMatches.sweepCandidate(good), 0);
    assert.strictEqual(notesFor(good).length, 1);
  });

  await t('when a candidate\'s situation improves they are told (the "you can now apply" notice)', async () => {
    assert.strictEqual(await jobMatches.sweepCandidate(weak), 0);
    levels[String(weak._id)] = [{ key: 'linux', label: 'Linux', level: 'Intermediate' }];
    assert.strictEqual(await jobMatches.sweepCandidate(weak), 1);
    assert.strictEqual(notesFor(weak).length, 1);
    assert.strictEqual(await jobMatches.sweepCandidate(weak), 0);
  });

  await t('jobs a candidate already applied to are not announced', async () => {
    const other = makePosting({ title: 'Other Job' });
    asCandidate(good);
    await post(`/jobs/${other._id}/apply`);
    notes.length = 0;
    assert.strictEqual(await jobMatches.sweepCandidate(good), 0);
    assert.strictEqual(notesFor(good).length, 0);
  });

  await t('a candidate withdrawn by a requirement change is told again once they meet it', async () => {
    const strict = makePosting({ title: 'Strict Job' });
    const dee = makeCandidate('Dee', 'Advanced');
    await jobMatches.sweepCandidate(dee);
    assert.ok(jobNotices.some((x) => String(x.candidateId) === String(dee._id) && String(x.jobId) === String(strict._id)));
    asCandidate(dee); await post(`/jobs/${strict._id}/apply`);
    const a = apps.find((x) => String(x.candidateId) === String(dee._id) && String(x.jobId) === String(strict._id));
    // the recruiter tightens the job to Expert: Dee is withdrawn
    asOwner();
    const form = {
      skills: [{ key: 'linux', minLevel: 'Expert' }, { key: '', minLevel: '' }, { key: '', minLevel: '' }],
      titleId: 'cloud-engineer', nickname: 'x', hiringCompany: 'Acme <Corp>', authorizedToRecruit: 'on', employmentType: 'full_time', openings: '1',
      arrangement: 'remote', relocation: 'no', travel: 'none', shift: 'daytime', basePayType: 'salary', baseMin: '100000', baseMax: '120000',
      payBasis: ['skill_level'], benefits: ['health'], goodFaith: 'on', education: '', certGroups: [['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']], clearance: '',
      closeDate: new Date(strict.closeDate.getTime() - 4 * 3600000).toISOString().slice(0, 10), startDate: strict.startDate.toISOString().slice(0, 10),
      summary: 'Run our cloud platform with a small friendly team that ships every week.', responsibilities: 'Operate infrastructure\nImprove pipelines\nRespond to incidents', requirementsAttested: 'on', outcomeAck: 'on', confirmWithdraw: 'on',
    };
    const res = await post(`/recruiter-jobs/${strict._id}/edit`, form);
    assert.strictEqual(res.status, 302, await res.clone().text());
    assert.strictEqual(a.status, 'withdrawn');
    notes.length = 0;
    assert.strictEqual(await jobMatches.sweepCandidate(dee), 0); // still below Expert
    levels[String(dee._id)] = [{ key: 'linux', label: 'Linux', level: 'Expert' }];
    assert.strictEqual(await jobMatches.sweepCandidate(dee), 1);
    assert.ok(notesFor(dee)[0].title.includes('Cloud Engineer'));
  });

  await t('the Monday list holds every open job the candidate can apply to, minus ones applied to', async () => {
    const list = await jobMatches.qualifyingJobsFor(good);
    assert.deepStrictEqual(list.map((j) => j.title).sort(), ['Linux Admin']);
    assert.ok(list.every((j) => j.path.startsWith('/jobs/') && j.pay));
    assert.ok(!list.some((j) => j.title === 'Other Job'));
    assert.deepStrictEqual(await jobMatches.qualifyingJobsFor(hidden), []);
    assert.deepStrictEqual(await jobMatches.qualifyingJobsFor(unverified), []);
  });

  await t('the recap section lists the jobs with safe links', async () => {
    const html = weeklyJobsSection([{ title: 'A <b>Job</b>', company: 'Acme & Co', location: 'Remote', pay: '$1 a year', path: '/jobs/1/x' }], 'https://precheckd.test');
    assert.ok(html.includes('Jobs you qualify for') && html.includes('https://precheckd.test/jobs/1/x') && html.includes('A &lt;b&gt;Job&lt;/b&gt;') && html.includes('Acme &amp; Co'));
  });

  // ===== recruiter daily email =====
  const monday9 = new Date('2026-12-07T14:00:00Z'); // Monday 9:00 ET (kept in the future so the test does not depend on today's date)
  const sunday9 = new Date('2026-10-25T13:00:00Z');
  const digestJob = makePosting({ title: 'Digest Job' });
  const f1 = makeCandidate('Fay'); const f2 = makeCandidate('Flo');
  for (const c of [f1, f2]) { asCandidate(c); await post(`/jobs/${digestJob._id}/apply`); }
  const sentTo = [];
  Recruiter.find = async () => [recruiterDoc];
  Recruiter.findOneAndUpdate = async (f, u) => { Object.assign(recruiterDoc, u); return recruiterDoc; };
  Recruiter.updateOne = async (f, u) => { Object.assign(recruiterDoc, u); };
  const send = async (r, groups) => { sentTo.push({ r, groups }); };

  await t('the daily email only goes out on weekday mornings', async () => {
    assert.ok(inWindow(monday9) && !inWindow(sunday9));
    assert.strictEqual((await runApplicantDigest({ now: sunday9, send })).outsideWindow, true);
    assert.strictEqual(sentTo.length, 0);
  });

  await t('it lists new applicants by posting, once, and only when there are some', async () => {
    recruiterDoc.lastApplicantDigestAt = new Date('2026-10-01T00:00:00Z'); // the last email was before these applications
    const r = await runApplicantDigest({ now: monday9, send });
    assert.strictEqual(r.sent, 1);
    assert.strictEqual(sentTo[0].groups.find((g) => g.title === 'Digest Job').count, 2);
    const again = await runApplicantDigest({ now: new Date(monday9.getTime() + 3600000), send });
    assert.strictEqual(again.sent, 0);
  });

  await t('the recruiter can turn the email off and on from My job postings', async () => {
    asOwner();
    await post('/recruiter-jobs/digest', {});
    assert.strictEqual(recruiterDoc.applicantDigestOptOut, true);
    await post('/recruiter-jobs/digest', { digest: 'on' });
    assert.strictEqual(recruiterDoc.applicantDigestOptOut, false);
  });

  server.close();
  console.log(`\n${n} tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
