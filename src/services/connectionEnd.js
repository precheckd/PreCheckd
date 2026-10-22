// Ending a connection, and the ~30-day survey the candidate gets about the recruiter (spec section 16).
const ConnectionRequest = require('../models/ConnectionRequest');
const JobApplication = require('../models/JobApplication');
const TrackerApplication = require('../models/Application');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const { ACTIVE, withdrawApplication } = require('./jobApplications');
const { notify } = require('./notifications');
const { findReason, SURVEY_CONTACTED, SURVEY_RESPECTFUL } = require('../content/endReasons');
const { scanText } = require('../utils/textScan');

const DAY = 86400000;
const SURVEY_AFTER_DAYS = 30;

function clean(note) { return String(note || '').replace(/\s+/g, ' ').trim().slice(0, 300); }
function noteProblem(note) { const hits = note ? scanText(note) : []; return hits.length ? hits[0].message : null; }

// side: 'candidate' | 'recruiter'. Returns { ok, error? }.
async function endConnection(conn, side, { reason, note } = {}, { now = new Date(), alert } = {}) {
  if (!conn || conn.status !== 'accepted') return { ok: false, error: 'This connection is not active.' };
  const r = findReason(side, String(reason || ''));
  if (!r) return { ok: false, error: 'Choose a reason.' };
  const text = clean(note);
  if (r.code === 'other' && text.length < 5) return { ok: false, error: 'Add a few words for "Other".' };
  const problem = noteProblem(text);
  if (problem) return { ok: false, error: problem };

  conn.status = 'ended'; conn.endedAt = now; conn.endedBy = side; conn.endReason = r.code; conn.endNote = text;
  if (conn.fullAccessStatus === 'granted' || conn.fullAccessStatus === 'requested') conn.fullAccessStatus = 'none';
  await conn.save();

  // Live applications between these two are closed out.
  const live = await JobApplication.find({ candidateId: conn.candidateId, recruiterId: conn.recruiterId, status: { $in: ACTIVE } });
  for (const app of live) {
    if (side === 'candidate') { await withdrawApplication(app, { by: 'candidate', note: 'You ended the connection' }, now); continue; }
    app.status = 'rejected'; app.stageChangedAt = now; app.rejectionReason = 'connection_ended';
    app.rejectionText = 'The recruiter ended this connection.';
    await app.save();
    if (app.trackerId) {
      const t = await TrackerApplication.findById(app.trackerId);
      if (t) { t.status = 'rejected'; t.lastActivityAt = now; t.history.push({ at: now, status: 'rejected', by: 'you', note: 'The connection ended' }); await t.save(); }
    }
    await notify('candidate', conn.candidateId, 'job_closed', 'The recruiter ended this connection, so your application was closed.', '/tracker');
  }

  // The other side sees only a neutral notice.
  if (side === 'candidate') await notify('recruiter', conn.recruiterId, 'connection_ended', 'A connection was ended.', '/connections');
  else await notify('candidate', conn.candidateId, 'connection_ended', 'A connection was ended.', '/connections');

  if (r.alert) {
    const tell = alert || require('./emailService').sendStaffAlertEmail;
    try {
      await tell({ subject: 'Connection ended with a safety reason', headline: 'A connection was ended for a safety reason',
        paragraphs: [`Connection ${conn._id} was ended by the ${side}: "${r.label}". Candidate ${conn.candidateId}, recruiter ${conn.recruiterId}.${text ? ` Note: ${text}` : ''}`] });
    } catch (e) { console.error('Staff alert failed:', e.message); }
  }
  return { ok: true };
}

// A candidate who ended a connection is not asked again by that recruiter.
async function endedByCandidate(candidateId, recruiterId) {
  return !!(await ConnectionRequest.findOne({ candidateId, recruiterId, status: 'ended', endedBy: 'candidate' }));
}

// ---- 30-day survey --------------------------------------------------------------------------------

async function sendDueSurveys({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - SURVEY_AFTER_DAYS * DAY);
  const due = await ConnectionRequest.find({ status: 'accepted', surveySentAt: null, respondedAt: { $lt: cutoff } });
  let sent = 0;
  for (const c of due) {
    c.surveySentAt = now;
    await c.save();
    const rec = await Recruiter.findById(c.recruiterId);
    const who = rec ? `${rec.firstName} ${rec.lastName}` : 'a recruiter';
    await notify('candidate', c.candidateId, 'connection_survey', `A quick question about ${who} (30 seconds, private).`.slice(0, 200), `/connections/${c._id}/survey`);
    sent += 1;
  }
  return { sent };
}

function validateSurvey(body) {
  const b = body || {};
  const errors = {};
  const contacted = String(b.contacted || ''); const respectful = String(b.respectful || '');
  if (!SURVEY_CONTACTED.some((x) => x.code === contacted)) errors.contacted = 'Choose an answer.';
  if (!SURVEY_RESPECTFUL.some((x) => x.code === respectful)) errors.respectful = 'Choose an answer.';
  const note = clean(b.note);
  const problem = noteProblem(note);
  if (problem) errors.note = problem;
  return { errors, value: { contacted, respectful, note } };
}

async function saveSurvey(conn, value, { now = new Date(), alert } = {}) {
  conn.survey = { answeredAt: now, contacted: value.contacted, respectful: value.respectful, note: value.note };
  await conn.save();
  if (value.contacted === 'not_real' || value.respectful === 'no') {
    const tell = alert || require('./emailService').sendStaffAlertEmail;
    try {
      await tell({ subject: 'Negative recruiter survey answer', headline: 'A candidate flagged a recruiter in the 30-day survey',
        paragraphs: [`Connection ${conn._id}, recruiter ${conn.recruiterId}: contacted = ${value.contacted}, respectful = ${value.respectful}.${value.note ? ` Note: ${value.note}` : ''}`] });
    } catch (e) { console.error('Staff alert failed:', e.message); }
  }
}

module.exports = { endConnection, endedByCandidate, sendDueSurveys, validateSurvey, saveSurvey, SURVEY_AFTER_DAYS };
