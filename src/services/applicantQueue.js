// The review queue: a posting stops taking new applications while too many applicants are waiting on the
// recruiter. "Waiting" means no real decision yet: still Applied or only Screening. A recruiter frees a place by
// interviewing the person, hiring them, or not moving forward with them (which needs an area to work on), so
// nobody can sit on a pile of applicants. Moving someone to Screening does NOT free a place.
const JobApplication = require('../models/JobApplication');

const WAITING = ['applied', 'screening'];
const LIMIT = Number(process.env.APPLICANT_QUEUE_LIMIT) || 20;
const WARN_AT = Math.max(1, Math.floor(LIMIT * 0.75)); // 15 with the default limit

async function waitingCount(jobId) {
  return JobApplication.countDocuments({ jobId, status: { $in: WAITING } });
}

// The shape the apply gate reads, plus whether the queue is full.
async function gateShape(posting) {
  const shape = posting.toGateShape();
  shape.queueFull = (await waitingCount(posting._id)) >= LIMIT;
  return shape;
}

module.exports = { WAITING, LIMIT, WARN_AT, waitingCount, gateShape };
