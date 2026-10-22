// Applying to a job, withdrawing, and what editing a posting does to people who already applied.
// See docs/job-board-spec.md sections 3, 4 and 11.
//
// Applying opens the candidate's full profile, video and resume to that recruiter through an automatic
// connection. On a rejection (a later step) the access stops but the connection stays.
const JobApplication = require('../models/JobApplication');
const ConnectionRequest = require('../models/ConnectionRequest');
const TrackerApplication = require('../models/Application');
const { notify } = require('./notifications');

const ACTIVE = ['applied', 'screening', 'interviewing', 'offer'];

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

module.exports = { ACTIVE, activeApplicants, applyToJob, withdrawApplication, releaseAccess };
