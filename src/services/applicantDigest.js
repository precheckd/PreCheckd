// The recruiter's daily "new applicants" email (docs/job-board-spec.md section 4). Weekdays 8:00-10:59 ET, at most
// one per recruiter per ~20 hours, only when there is something to say. A switch on My job postings turns it off.
// The bell for each new applicant is separate and immediate (services/jobApplications.js).
const Recruiter = require('../models/Recruiter');
const JobApplication = require('../models/JobApplication');
const JobPosting = require('../models/JobPosting');
const { HAS_APPLIED } = require('./jobApplications');
const { easternParts } = require('./weeklyEmails');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW = { startHour: 8, endHour: 11 };

function inWindow(now) {
  const p = easternParts(now);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(p.weekday) && p.hour >= WINDOW.startHour && p.hour < WINDOW.endHour;
}

// Groups new applications by posting: [{ jobId, title, company, count }]
async function newApplicantGroups(recruiterId, since) {
  const apps = await JobApplication.find({ recruiterId, appliedAt: { $gt: since }, status: { $in: HAS_APPLIED } });
  const counts = new Map();
  apps.forEach((a) => counts.set(String(a.jobId), (counts.get(String(a.jobId)) || 0) + 1));
  const groups = [];
  for (const [jobId, count] of counts) {
    const job = await JobPosting.findById(jobId);
    if (job) groups.push({ jobId, title: job.title, company: job.hiringCompany, count });
  }
  return groups;
}

async function runApplicantDigest({ now = new Date(), send } = {}) {
  if (!inWindow(now)) return { sent: 0, skipped: 0, outsideWindow: true };
  const deliver = send || require('./emailService').sendApplicantDigestEmail;
  const cutoff = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  const recruiters = await Recruiter.find({
    email: { $ne: null }, isActive: true, isSuspended: { $ne: true }, applicantDigestOptOut: { $ne: true },
    $or: [{ lastApplicantDigestAt: null }, { lastApplicantDigestAt: { $lt: cutoff } }],
  });
  let sent = 0; let skipped = 0;
  for (const recruiter of recruiters) {
    try {
      const since = recruiter.lastApplicantDigestAt || new Date(now.getTime() - DAY_MS);
      const groups = await newApplicantGroups(recruiter._id, since);
      if (!groups.length) { skipped += 1; continue; }
      const claimed = await Recruiter.findOneAndUpdate(
        { _id: recruiter._id, applicantDigestOptOut: { $ne: true }, $or: [{ lastApplicantDigestAt: null }, { lastApplicantDigestAt: { $lt: cutoff } }] },
        { lastApplicantDigestAt: now }, { new: true });
      if (!claimed) { skipped += 1; continue; }
      try { await deliver(recruiter, groups); sent += 1; } catch (err) {
        console.error('Failed to send applicant digest:', err);
        await Recruiter.updateOne({ _id: recruiter._id }, { lastApplicantDigestAt: recruiter.lastApplicantDigestAt }).catch(() => {});
        skipped += 1;
      }
    } catch (err) { console.error('Applicant digest failed for a recruiter:', err); skipped += 1; }
  }
  return { sent, skipped };
}

module.exports = { runApplicantDigest, newApplicantGroups, inWindow };
