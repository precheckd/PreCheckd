// Application tests. Every Junior-to-Expert posting gets a CUSTOM test that staff generate in CoderByte from its job
// description (staff paste the description in, then register the test's id on /custom-tests). Entry level postings use
// the one general Entry Level test. Applicants of a posting whose test is not attached yet wait in a queue and are told
// it arrives within ROLE_TEST_PROMISE_DAYS business days; attaching the test releases them at once.
const SkillAssessment = require('../models/SkillAssessment');
const JobApplication = require('../models/JobApplication');
const { notify } = require('./notifications');
const Candidate = require('../models/Candidate');
const JobPosting = require('../models/JobPosting');

// Bell plus email to the candidate (skillNotifications.deliver). Never blocks the caller.
async function tell(candidateId, kind, name, extra) {
  try {
    const c = await Candidate.findById(candidateId);
    if (c) await require('./skillNotifications').deliver(c, kind, name, extra);
  } catch (e) { console.error('[roleTests] candidate notice failed:', e.message); }
}

const PROMISE_DAYS = () => Number(process.env.ROLE_TEST_PROMISE_DAYS) || 2;   // the single setting
const promiseText = () => `within ${PROMISE_DAYS()} business days`;
const ENTRY_KEY = 'entry-level';   // the one general test every Entry level posting uses, whatever its role
const isEntry = (posting) => posting.seniorityLabel === 'Entry level';

const entryTest = () => SkillAssessment.findOne({ active: true, kind: 'title', roleKey: ENTRY_KEY, roleLevel: 'Entry' });
const customTest = (assessmentId) => (assessmentId
  ? SkillAssessment.findOne({ active: true, kind: 'custom', assessmentId }) : null);
// The test a posting's applicants take, or null while it is still being built.
const testFor = (posting) => (isEntry(posting) ? entryTest() : customTest(posting.customTestAssessmentId));
const queueKey = (posting) => (isEntry(posting) ? ENTRY_KEY : `posting:${posting._id}`);

const adminUrl = () => `https://${process.env.ADMIN_HOSTNAME || 'admin.precheckd.com'}/custom-tests`;

// The job description as plain text, ready to paste into CoderByte's "generate from job description".
function descriptionFor(posting) {
  const lines = [`${posting.title} at ${posting.hiringCompany}`, '', posting.summary || ''];
  if ((posting.responsibilities || []).length) lines.push('', 'Key Responsibilities:', ...posting.responsibilities.map((r) => `- ${r}`));
  if ((posting.skills || []).length) lines.push('', 'Requirements:', ...posting.skills.map((x) => `- ${x.label}${x.minLevel ? ` (${x.minLevel} level or above)` : ''}`));
  return lines.join('\n').trim();
}

const needsCustom = (posting) => !isEntry(posting);

async function alertStaff(posting) {
  try {
    const waiting = await JobApplication.countDocuments({ roleTestStatus: 'waiting', roleTestLevelKey: queueKey(posting) });
    const label = isEntry(posting) ? 'the Entry Level (General) test' : `a custom test for "${posting.title}" at ${posting.hiringCompany}`;
    await require('./emailService').sendStaffAlertEmail({
      subject: isEntry(posting) ? 'Entry Level test needed' : `Custom test needed: ${posting.title}`,
      headline: 'A test needs building',
      paragraphs: [
        isEntry(posting)
          ? `${waiting <= 1 ? 'The first applicant is' : `${waiting} applicants are`} waiting for ${label}.`
          : `A new posting is live and needs ${label}. Open the screen, copy the job description into CoderByte's generator, then save the test id.`,
        `Applicants are told it will arrive ${promiseText()}.`
      ],
      buttonUrl: adminUrl(), buttonLabel: 'Open custom tests'
    });
  } catch (e) { console.error('[roleTests] staff alert failed:', e.message); }
}

// Call when a posting goes live (create or edit). Flags it for a custom test once; safe to call repeatedly.
async function requestForPosting(posting) {
  if (!posting || !needsCustom(posting) || posting.customTestAssessmentId || posting.customTestRequestedAt) return false;
  posting.customTestRequestedAt = new Date();
  await posting.save();
  await alertStaff(posting);
  return true;
}

// Call right after an application is saved. Returns 'none' | 'ready' | 'waiting'.
async function onApplied(app, posting) {
  if (needsCustom(posting) && !posting.customTestRequestedAt && !posting.customTestAssessmentId) await requestForPosting(posting);
  const test = await testFor(posting);
  app.roleTestLevelKey = queueKey(posting);
  if (test) {
    app.roleTestStatus = 'ready'; app.roleTestAssessmentId = test.assessmentId; app.roleTestReadyAt = new Date();
    await app.save();
    await tell(app.candidateId, 'role_test_ready', test.name);
    return 'ready';
  }
  app.roleTestStatus = 'waiting';
  await app.save();
  await tell(app.candidateId, 'role_test_waiting', isEntry(posting) ? 'Entry Level (General)' : posting.title, promiseText());
  if (isEntry(posting)) {
    const first = (await JobApplication.countDocuments({ roleTestStatus: 'waiting', roleTestLevelKey: app.roleTestLevelKey })) === 1;
    if (first) await alertStaff(posting);
  }
  return 'waiting';
}

// Flips every waiting applicant whose test now exists to ready and tells them. Safe to run any time.
async function releaseWaiting() {
  const waiting = await JobApplication.find({ roleTestStatus: 'waiting' });
  let n = 0;
  const cache = new Map();
  for (const app of waiting) {
    if (!cache.has(String(app.jobId))) {
      const posting = await JobPosting.findById(app.jobId);
      cache.set(String(app.jobId), posting ? await testFor(posting) : null);
    }
    const test = cache.get(String(app.jobId));
    if (!test) continue;
    app.roleTestStatus = 'ready'; app.roleTestAssessmentId = test.assessmentId; app.roleTestReadyAt = new Date();
    await app.save();
    await tell(app.candidateId, 'role_test_ready', test.name);
    n++;
  }
  return n;
}

// Pulls a CoderByte test id out of whatever staff paste: a bare id, or a link containing it.
function parseTestRef(input) {
  const t = String(input || '').trim();
  // A CoderByte id looks like words-then-ten-characters (software-engineer-r6fiquec3e), alone or inside any link
  // (invite links hold it after "promo=<account>:", report links after "<user>:").
  const all = [...t.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{8,12}(?![a-z0-9-])/gi)].map((x) => x[0]);
  const withDigit = all.filter((x) => /\d/.test(x.split('-').pop()));   // the random tail has digits; "sl-candidate" does not
  if (withDigit.length) return withDigit[withDigit.length - 1];
  if (all.length) return all[all.length - 1];
  return /^[A-Za-z0-9_-]{6,}$/.test(t) ? t : null;
}

// Staff finished building the custom test for a posting: register it, release the waiting applicants, tell the recruiter.
async function attach(posting, ref, { name, lookup } = {}) {
  const id = parseTestRef(ref);
  if (!id) { const e = new Error('Could not find a test id in that.'); e.code = 'bad_ref'; throw e; }
  const found = lookup ? await lookup(id) : await require('./coderbyte').api('GET', '/assessments').then((r) => {
    const list = (r && r.data && r.data.assessments) || (r && r.assessments) || (Array.isArray(r) ? r : []);   // same shape the seed script reads
    return list.find((x) => String(x.test_id || x.id) === id);
  });
  if (!found) { const e = new Error('CoderByte has no test with that id.'); e.code = 'not_found'; throw e; }
  const title = name || found.name || found.title || `${posting.title} (custom)`;
  await SkillAssessment.findOneAndUpdate({ assessmentId: id }, {
    $set: { assessmentId: id, name: title, kind: 'custom', postingId: posting._id, active: true, publicUrl: found.public_url || found.publicUrl }
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  posting.customTestAssessmentId = id;
  await posting.save();
  const released = await releaseWaiting();
  try { await notify('recruiter', posting.recruiterId, 'role_test_done', `Your custom test for ${posting.title} is ready and has been sent to applicants`.slice(0, 200), `/recruiter-jobs/${posting._id}/applicants`); } catch (_) { /* best effort */ }
  return { id, released };
}

// Postings that need a custom test, oldest first, with how many applicants are waiting on each.
async function customQueue() {
  const postings = await JobPosting.find({ customTestRequestedAt: { $ne: null }, customTestAssessmentId: { $in: [null, ''] } }).sort({ customTestRequestedAt: 1 });
  const out = [];
  for (const p of postings) {
    const waiting = await JobApplication.countDocuments({ jobId: p._id, roleTestStatus: 'waiting' });
    out.push({ posting: p, waiting, description: descriptionFor(p) });
  }
  return out;
}

async function queue() {
  const rows = (await customQueue()).map((r) => ({ key: `${r.posting.title} (${r.posting.hiringCompany})`, count: r.waiting, oldest: r.posting.customTestRequestedAt }));
  const entry = await JobApplication.find({ roleTestStatus: 'waiting', roleTestLevelKey: ENTRY_KEY }).sort({ appliedAt: 1 });
  if (entry.length) rows.push({ key: 'Entry Level (General)', count: entry.length, oldest: entry[0].appliedAt });
  return rows;
}

async function digest(now = Date.now()) {
  const q = await queue();
  if (!q.length) return 0;
  const { businessHoursSince } = require('../utils/businessTime');
  const rows = q.map((g) => `${g.key}: ${g.count} waiting, oldest ${Math.round(businessHoursSince(g.oldest, now))} business hours`);
  try {
    await require('./emailService').sendStaffAlertEmail({ subject: `${q.length} test${q.length === 1 ? '' : 's'} waiting to be built`, headline: 'Tests waiting to be built', paragraphs: rows, buttonUrl: adminUrl(), buttonLabel: 'Open custom tests' });
  } catch (e) { console.error('[roleTests] digest failed:', e.message); }
  return q.length;
}

const ACTIVE = ['applied', 'screening', 'interviewing', 'offer'];
const published = (r) => r && r.status === 'completed' && (!r.held || r.reviewDecision === 'approved');

// The candidate's applications whose role test is ready to take (or in progress), for their Skills page.
async function pendingFor(candidate) {
  const apps = await JobApplication.find({ candidateId: candidate._id, roleTestStatus: 'ready', status: { $in: ACTIVE } });
  const out = [];
  for (const a of apps) {
    const [posting, test] = await Promise.all([JobPosting.findById(a.jobId), SkillAssessment.findOne({ assessmentId: a.roleTestAssessmentId })]);
    if (!posting) continue;
    out.push({ id: String(a._id), job: posting.title, company: posting.hiringCompany, test: (test && test.name) || posting.title, started: Boolean(a.roleTestResultId) });
  }
  return out;
}

// Starts (or resumes) the role test for one of the candidate's own applications. Throws .code not_found | not_ready,
// plus startAttempt's own (retake_wait, manual, locked, not_found).
async function start(candidate, applicationId) {
  const app = await JobApplication.findOne({ _id: applicationId, candidateId: candidate._id }).catch(() => null);
  if (!app || !ACTIVE.includes(app.status)) { const e = new Error('Not found'); e.code = 'not_found'; throw e; }
  if (app.roleTestStatus !== 'ready' || !app.roleTestAssessmentId) { const e = new Error('Not ready'); e.code = 'not_ready'; throw e; }
  const attempt = await require('./skills').startAttempt(candidate, app.roleTestAssessmentId);
  app.roleTestResultId = attempt._id;
  await app.save();
  return attempt;
}

// Called whenever an attempt's outcome changes. Published -> the score goes on the application and the recruiter is
// told once. Rejected (integrity check) -> the application goes back to "ready" so they can try again.
async function onResult(result) {
  const app = await JobApplication.findOne({ roleTestResultId: result._id });
  if (!app || result.status !== 'completed') return null;
  if (result.reviewDecision === 'rejected') { app.roleTestResultId = null; await app.save(); return app; }
  if (!published(result)) return app;
  if (app.roleTestStatus === 'done') {   // a repeat sync: just refresh the written answers
    if ((result.freeForm || []).length && app.roleTestResult) { app.roleTestResult.freeForm = result.freeForm.map((f) => ({ question: f.question, answer: f.answer })); app.markModified('roleTestResult'); await app.save(); }
    return app;
  }
  app.roleTestResult = { score: result.overallScore, takenAt: result.completedAt || new Date(), freeForm: (result.freeForm || []).map((f) => ({ question: f.question, answer: f.answer })) };
  app.roleTestStatus = 'done';
  await app.save();
  const posting = await JobPosting.findById(app.jobId);
  await notify('recruiter', app.recruiterId, 'role_test_done', `A role test score is in for ${posting ? posting.title : 'your job'}`.slice(0, 200), `/recruiter-jobs/${app.jobId}/applicants`);
  return app;
}

module.exports = { pendingFor, start, onResult, onApplied, requestForPosting, attach, customQueue, parseTestRef, descriptionFor, releaseWaiting, queue, digest, promiseText, PROMISE_DAYS };
