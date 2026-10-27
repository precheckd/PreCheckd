// Applying to a job, withdrawing, and what editing a posting does to people who already applied.
// See docs/job-board-spec.md sections 3, 4 and 11.
//
// Applying opens the candidate's full profile, video and resume to that recruiter through an automatic
// connection. On a rejection (a later step) the access stops but the connection stays.
const JobApplication = require('../models/JobApplication');
const ConnectionRequest = require('../models/ConnectionRequest');
const TrackerApplication = require('../models/Application');
const { notify } = require('./notifications');

const ACTIVE = ['applied', 'screening', 'interviewing', 'offer'];            // still in play: access is open
const HAS_APPLIED = [...ACTIVE, 'hired', 'rejected'];                         // cannot apply again
const { byCode } = require('../content/rejectionReasons');
const STAGE_LABEL = { applied: 'Applied', screening: 'Screening', interviewing: 'Interviewing', offer: 'Offer', hired: 'Hired', rejected: 'Not moving forward' };
const TRACKER_STATUS = { applied: 'applied', screening: 'screening', interviewing: 'interviewing', offer: 'offer', hired: 'offer', rejected: 'rejected' };

async function activeApplicants(jobId) {
  return JobApplication.find({ jobId, status: { $in: ACTIVE } });
}

// The connection that carries the shared access. Applying is the candidate's consent, so it is accepted and
// the full profile (video and resume) is granted straight away.
async function openConnection(candidate, posting, now) {
  let conn = await ConnectionRequest.findOne({ candidateId: candidate._id, recruiterId: posting.recruiterId });
  if (!conn) {
    conn = new ConnectionRequest({
      candidateId: candidate._id, recruiterId: posting.recruiterId, status: 'accepted', initiatedBy: 'candidate',
      note: `Applied to ${posting.title}`.slice(0, 500), respondedAt: now,
    });
  }
  conn.status = 'accepted';
  if (!conn.respondedAt) conn.respondedAt = now;
  conn.fullAccessStatus = 'granted';
  conn.fullAccessRespondedAt = now;
  conn.fullAccessExpiresAt = null;
  await conn.save();
  return conn;
}

async function applyToJob(candidate, posting, now = new Date()) {
  const conn = await openConnection(candidate, posting, now);
  let app = await JobApplication.findOne({ jobId: posting._id, candidateId: candidate._id });
  if (!app) app = new JobApplication({ jobId: posting._id, candidateId: candidate._id, recruiterId: posting.recruiterId });
  app.status = 'applied';
  app.appliedAt = now;
  app.withdrawnAt = null; app.withdrawnBy = null; app.withdrawnNote = '';
  app.connectionId = conn._id;

  // the candidate's own tracker
  let tracker = app.trackerId ? await TrackerApplication.findById(app.trackerId) : null;
  if (!tracker) {
    tracker = new TrackerApplication({
      candidateId: candidate._id, company: posting.hiringCompany, roleTitle: posting.title, appliedAt: now,
      jobUrl: `/jobs/${posting._id}`, source: 'precheckd', jobPostingId: posting._id, history: [],
    });
  }
  tracker.status = 'applied';
  tracker.lastActivityAt = now;
  tracker.history.push({ at: now, status: 'applied', by: 'created', note: 'Applied on PreCheckd' });
  await tracker.save();
  app.trackerId = tracker._id;
  await app.save();

  await notify('recruiter', posting.recruiterId, 'job_applicant', `New applicant for ${posting.title}`.slice(0, 200), `/recruiter-jobs/${posting._id}/applicants`);
  return app;
}

// Stops the shared access unless the same candidate still has another live application with this recruiter.
async function releaseAccess(app) {
  const others = await JobApplication.find({ candidateId: app.candidateId, recruiterId: app.recruiterId, status: { $in: ACTIVE } });
  if (others.some((o) => String(o._id) !== String(app._id))) return;
  if (!app.connectionId) return;
  const conn = await ConnectionRequest.findById(app.connectionId);
  if (conn && conn.fullAccessStatus === 'granted') {
    conn.fullAccessStatus = 'none';
    await conn.save();
  }
}

async function withdrawApplication(app, { by, note = '' }, now = new Date()) {
  app.status = 'withdrawn';
  app.withdrawnAt = now; app.withdrawnBy = by; app.withdrawnNote = String(note).slice(0, 600);
  await app.save();
  if (app.trackerId) {
    const t = await TrackerApplication.findById(app.trackerId);
    if (t) {
      t.status = 'withdrawn'; t.lastActivityAt = now;
      t.history.push({ at: now, status: 'withdrawn', by: 'you', note: by === 'candidate' ? 'You withdrew' : 'Withdrawn: the job requirements changed' });
      await t.save();
    }
  }
  await releaseAccess(app);
}

// A recruiter moves an applicant along the fixed pipeline. Rejecting needs a reason from the fixed list (the
// candidate sees only the neutral sentence); it stops the shared access but keeps the connection. Hired and
// rejected are final in v1. Returns { ok, error? }.
async function moveStage(app, posting, stage, { reason } = {}, now = new Date()) {
  if (!STAGE_LABEL[stage]) return { ok: false, error: 'Pick a stage.' };
  if (!ACTIVE.includes(app.status)) return { ok: false, error: 'This applicant can no longer be moved.' };
  if (app.status === stage) return { ok: false, error: 'They are already at that stage.' };
  let rejection = null;
  if (stage === 'rejected') {
    rejection = byCode(reason);
    if (!rejection) return { ok: false, error: 'Choose a reason for not moving forward.' };
  }
  app.status = stage;
  app.stageChangedAt = now;
  if (rejection) { app.rejectionReason = rejection.code; app.rejectionText = rejection.candidateText; }
  await app.save();

  if (app.trackerId) {
    const t = await TrackerApplication.findById(app.trackerId);
    if (t) {
      t.status = TRACKER_STATUS[stage]; t.lastActivityAt = now;
      t.history.push({ at: now, status: TRACKER_STATUS[stage], by: 'you', note: stage === 'hired' ? 'Hired through PreCheckd' : 'Updated by the recruiter' });
      await t.save();
    }
  }
  if (stage === 'rejected') await releaseAccess(app);

  const what = stage === 'rejected' ? `Update on ${posting.title}: ${rejection.candidateText}`
    : stage === 'hired' ? `Congratulations! You were hired for ${posting.title} at ${posting.hiringCompany}.`
    : `Your application for ${posting.title} moved to ${STAGE_LABEL[stage]}.`;
  let link = `/jobs/${posting._id}`;
  if (stage === 'hired') {
    // The bell takes a hired candidate to the optional "share your news" page.
    try { const c = await require('../models/Candidate').findById(app.candidateId); if (c && c.slug) link = `/candidate/${c.slug}/share-hire/${app._id}`; } catch (e) { /* the job link still works */ }
  }
  await notify('candidate', app.candidateId, 'job_stage', what.slice(0, 200), link);
  return { ok: true };
}

module.exports = { ACTIVE, HAS_APPLIED, STAGE_LABEL, moveStage, activeApplicants, applyToJob, withdrawApplication, releaseAccess };
