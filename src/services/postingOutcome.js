// The close date and the outcome gate (docs/job-board-spec.md section 15; Kent's roadmap item 3).
// No silent expiry: when a posting's close date passes it becomes "awaiting outcome" and the recruiter's account
// is paused (middleware/outcomeGate.js) until they say how it ended. Ending a posting early takes the same form.
const crypto = require('crypto');
const JobPosting = require('../models/JobPosting');
const JobApplication = require('../models/JobApplication');
const TrackerApplication = require('../models/Application');
const { ACTIVE, moveStage, releaseAccess } = require('./jobApplications');
const { notify } = require('./notifications');
const { isBlockedEmailDomain } = require('../utils/blockedEmailDomains');
const { scanFields } = require('../utils/textScan');
const { OUTCOME_KINDS, NOT_FILLED_REASONS, CANCEL_REASONS, CLOSURE_TEXT } = require('../content/outcomeReasons');

const DAY = 86400000;
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

// Open postings whose close date has passed become awaiting_outcome. recruiterId limits it to one recruiter.
async function closeExpired({ recruiterId = null, now = new Date() } = {}) {
  const filter = { status: 'open', closeDate: { $lt: now } };
  if (recruiterId) filter.recruiterId = recruiterId;
  return JobPosting.updateMany(filter, { status: 'awaiting_outcome', awaitingOutcomeAt: now });
}

// The oldest posting this recruiter still owes an outcome for, or null.
async function awaitingPostingFor(recruiterId) {
  const list = await JobPosting.find({ recruiterId, status: 'awaiting_outcome' });
  return list.sort((a, b) => new Date(a.closeDate) - new Date(b.closeDate))[0] || null;
}

function reasonList(kind) { return kind === 'cancelled' ? CANCEL_REASONS : NOT_FILLED_REASONS; }

// body: { kind, hiredIds[], hireName, hireEmail, reason, reasonNote }. liveIds: ids of applicants still in play.
function validateOutcome(body, { posting, liveIds }) {
  const errors = {}; const value = {};
  const b = body || {};
  const kind = String(b.kind || '');
  if (!OUTCOME_KINDS.some((k) => k.code === kind)) errors.kind = 'Choose how this job ended.';
  value.kind = kind;
  const note = String(b.reasonNote || '').replace(/\s+/g, ' ').trim().slice(0, 300);

  if (kind === 'hired_precheckd') {
    const ids = [].concat(b.hiredIds || []).map(String).filter(Boolean);
    const unique = [...new Set(ids)];
    if (!unique.length) errors.hiredIds = 'Pick who you hired.';
    else if (unique.some((id) => !liveIds.includes(id))) errors.hiredIds = 'Pick from the applicants listed.';
    else if (unique.length > posting.openings) errors.hiredIds = `This job had ${posting.openings} opening${posting.openings === 1 ? '' : 's'}.`;
    value.hiredIds = unique;
  } else if (kind === 'hired_elsewhere') {
    const name = String(b.hireName || '').replace(/\s+/g, ' ').trim();
    const email = String(b.hireEmail || '').trim().toLowerCase();
    if (name.length < 2 || name.length > 80 || /[<>@\d]/.test(name)) errors.hireName = 'Enter the full name of the person hired.';
    if (!EMAIL_RE.test(email)) errors.hireEmail = 'Enter their work email address.';
    else if (isBlockedEmailDomain(email)) errors.hireEmail = 'Use their work email at the hiring company, not a personal address.';
    value.hireName = name; value.hireEmail = email;
  } else if (kind === 'not_filled' || kind === 'cancelled') {
    const reason = String(b.reason || '');
    if (!reasonList(kind).some((r) => r.code === reason)) errors.reason = 'Choose a reason.';
    if (reason === 'other' && note.length < 5) errors.reasonNote = 'Explain in a few words.';
    value.reason = reason;
  }
  if (note) {
    const scan = scanFields({ reasonNote: note }).reasonNote;
    if (scan && scan.length && !errors.reasonNote) errors.reasonNote = scan[0].message;
  }
  value.reasonNote = note;
  return { errors, value };
}

// A live applicant who was not hired is told the posting closed, and their shared access stops.
async function closeOutApplicant(app, posting, text, now) {
  app.status = 'rejected'; app.stageChangedAt = now; app.rejectionReason = 'posting_closed'; app.rejectionText = text;
  await app.save();
  if (app.trackerId) {
    const t = await TrackerApplication.findById(app.trackerId);
    if (t) {
      t.status = 'rejected'; t.lastActivityAt = now;
      t.history.push({ at: now, status: 'rejected', by: 'you', note: 'The posting closed' });
      await t.save();
    }
  }
  await releaseAccess(app);
  await notify('candidate', app.candidateId, 'job_closed', `${posting.title} at ${posting.hiringCompany} has closed. ${text}`.slice(0, 200), `/jobs/${posting._id}`);
}

// Records the outcome and closes the posting. sendHireEmail({ to, title, company, url }) is injectable for tests.
async function recordOutcome(posting, value, { now = new Date(), sendHireEmail } = {}) {
  const live = await JobApplication.find({ jobId: posting._id, status: { $in: ACTIVE } });
  const hires = [];
  const hiredSet = new Set(value.hiredIds || []);
  let rawToken = null;

  if (value.kind === 'hired_precheckd') {
    for (const app of live.filter((a) => hiredSet.has(String(a._id)))) {
      await moveStage(app, posting, 'hired', {}, now);
      hires.push({ source: 'precheckd', applicationId: app._id, status: 'confirmed', respondedAt: now });
    }
  } else if (value.kind === 'hired_elsewhere') {
    rawToken = crypto.randomBytes(24).toString('hex');
    hires.push({ source: 'elsewhere', name: value.hireName, workEmail: value.hireEmail, tokenHash: hash(rawToken), status: 'pending', sentAt: now });
  }

  const text = CLOSURE_TEXT[value.kind];
  for (const app of live.filter((a) => !hiredSet.has(String(a._id)))) await closeOutApplicant(app, posting, text, now);

  posting.outcome = { kind: value.kind, reason: value.reason || null, reasonNote: value.reasonNote || '', recordedAt: now, hires };
  posting.status = 'closed';
  posting.closedAt = now;
  await posting.save();

  if (rawToken) {
    const send = sendHireEmail || require('./emailService').sendHireConfirmationEmail;
    try {
      await send({ to: value.hireEmail, title: posting.title, company: posting.hiringCompany, url: `${(process.env.APP_BASE_URL || 'https://precheckd.com').replace(/\/$/, '')}/hire-confirm/${rawToken}` });
    } catch (e) { console.error('Failed to send hire confirmation email:', e.message); }
  }
  return { closedOut: live.length - hiredSet.size, hired: hires.length };
}

// The person named as hired answers the confirmation email. answer: 'yes' | 'no'. Never shows their name or the recruiter.
async function answerHireConfirmation(token, answer, { now = new Date(), alert } = {}) {
  const th = hash(token);
  const list = await JobPosting.find({ 'outcome.hires.tokenHash': th });
  const posting = list[0];
  if (!posting) return { found: false };
  const hire = posting.outcome.hires.find((h) => h.tokenHash === th);
  const info = { found: true, title: posting.title, company: posting.hiringCompany };
  if (hire.status !== 'pending') return { ...info, status: hire.status, already: true };
  if (now.getTime() - new Date(hire.sentAt).getTime() > 30 * DAY) {
    hire.status = 'expired'; await posting.save();
    return { ...info, status: 'expired' };
  }
  if (answer !== 'yes' && answer !== 'no') return { ...info, status: 'pending', needsAnswer: true };
  hire.status = answer === 'yes' ? 'confirmed' : 'denied';
  hire.respondedAt = now;
  if (answer === 'no') posting.reviewFlag = 'hire_denied';
  await posting.save();
  if (answer === 'no') {
    const tell = alert || require('./emailService').sendStaffAlertEmail;
    try {
      await tell({ subject: 'A reported hire was denied', headline: 'A named hire says they were not hired', paragraphs: [`Posting ${posting._id} (${posting.title} at ${posting.hiringCompany}): the person named in the outcome says they were not hired. Check the recruiter's other outcomes.`] });
    } catch (e) { console.error('Staff alert failed:', e.message); }
  }
  return { ...info, status: hire.status };
}

// A recruiter who cancels and then posts the same title within 30 days is flagged for staff review.
async function flagRepost(posting, { now = new Date(), alert } = {}) {
  const all = await JobPosting.find({ recruiterId: posting.recruiterId });
  const prior = all.find((p) => String(p._id) !== String(posting._id) && p.titleId === posting.titleId
    && p.outcome && p.outcome.kind === 'cancelled' && p.closedAt && now.getTime() - new Date(p.closedAt).getTime() <= 30 * DAY);
  if (!prior) return false;
  posting.reviewFlag = 'repost_after_cancel';
  await posting.save();
  const tell = alert || require('./emailService').sendStaffAlertEmail;
  try {
    await tell({ subject: 'Job reposted after a cancellation', headline: 'Same title reposted within 30 days of a cancellation',
      paragraphs: [`Posting ${posting._id} (${posting.title}) was posted within 30 days of cancelling ${prior._id}. Check it is not a way around the outcome rules.`] });
  } catch (e) { console.error('Staff alert failed:', e.message); }
  return true;
}

module.exports = { closeExpired, awaitingPostingFor, validateOutcome, recordOutcome, answerHireConfirmation, flagRepost, reasonList, hash };
