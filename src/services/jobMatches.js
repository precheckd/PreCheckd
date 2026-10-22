// "You qualify for this job" notices (docs/job-board-spec.md section 4).
//  - A BELL for each job a candidate qualifies for: when a job is posted or edited (sweepPosting), and when the
//    candidate's own situation changes (sweepCandidate: a passed test, a verified degree or cert, a profile edit).
//    Each job is announced once per candidate (JobNotice).
//  - The FULL LIST goes in the Monday recap email (qualifyingJobsFor).
// Only candidates who are open to opportunities and fully verified are told; qualifying means canApply is true.
const JobPosting = require('../models/JobPosting');
const JobApplication = require('../models/JobApplication');
const JobNotice = require('../models/JobNotice');
const Candidate = require('../models/Candidate');
const { evaluate } = require('./applyGate');
const { toFacts, loadSkillFacts } = require('./applyFacts');
const { notify } = require('./notifications');
const pub = require('./publicJob');

const MAX_PER_SWEEP = 10;
const off = () => process.env.DISABLE_JOB_NOTICES === 'true' || process.env.NODE_ENV === 'test';

// An application that blocks a new notice: anything but a withdrawal forced by a requirement change
// (that person is told again once they meet the new requirement).
const stillApplied = (a) => !(a.status === 'withdrawn' && a.withdrawnBy === 'requirement_change');

async function openPostings(now = Date.now()) {
  return (await JobPosting.find({ status: 'open' })).filter((p) => pub.isOpenNow(p, now));
}

function canApplyTo(candidate, skills, posting, now) {
  const gate = posting.toGateShape();
  return evaluate(toFacts(candidate, { skills, posting: gate }), gate, now).canApply;
}

async function tell(candidate, posting) {
  try { await JobNotice.create({ candidateId: candidate._id, jobId: posting._id }); } catch (e) { return false; } // already told
  await notify('candidate', candidate._id, 'job_match', `You qualify for ${posting.title} at ${posting.hiringCompany}.`.slice(0, 200), pub.pathOf(posting));
  return true;
}

// A candidate's situation changed: announce any open job they now qualify for. Returns how many were announced.
async function sweepCandidate(candidate, { now = Date.now(), max = MAX_PER_SWEEP } = {}) {
  if (!candidate || candidate.openToOpportunities === false) return 0;
  const [postings, told, applied, skills] = await Promise.all([
    openPostings(now),
    JobNotice.find({ candidateId: candidate._id }),
    JobApplication.find({ candidateId: candidate._id }),
    loadSkillFacts(candidate._id, now),
  ]);
  const skip = new Set([...told, ...applied.filter(stillApplied)].map((x) => String(x.jobId)));
  let count = 0;
  for (const posting of postings) {
    if (count >= max) break;
    if (skip.has(String(posting._id))) continue;
    if (canApplyTo(candidate, skills, posting, now) && await tell(candidate, posting)) count += 1;
  }
  return count;
}

// A job was posted or changed: announce it to every candidate who qualifies.
async function sweepPosting(posting, { now = Date.now() } = {}) {
  if (!pub.isOpenNow(posting, now)) return 0;
  const candidates = await Candidate.find({ openToOpportunities: { $ne: false }, isPhoneVerified: true, isIdentityVerified: true });
  let count = 0;
  for (const candidate of candidates) {
    try {
      if (await JobNotice.findOne({ candidateId: candidate._id, jobId: posting._id })) continue;
      const prior = await JobApplication.findOne({ candidateId: candidate._id, jobId: posting._id });
      if (prior && stillApplied(prior)) continue;
      const skills = await loadSkillFacts(candidate._id, now);
      if (canApplyTo(candidate, skills, posting, now) && await tell(candidate, posting)) count += 1;
    } catch (e) { console.error('Job notice failed for a candidate:', e.message); }
  }
  return count;
}

// For the Monday recap: every open job this candidate can apply to right now and has not applied to.
async function qualifyingJobsFor(candidate, { now = Date.now(), limit = 10 } = {}) {
  if (!candidate || candidate.openToOpportunities === false) return [];
  const [postings, applied, skills] = await Promise.all([openPostings(now), JobApplication.find({ candidateId: candidate._id }), loadSkillFacts(candidate._id, now)]);
  const done = new Set(applied.filter(stillApplied).map((a) => String(a.jobId)));
  return postings
    .filter((p) => !done.has(String(p._id)) && canApplyTo(candidate, skills, p, now))
    .slice(0, limit)
    .map((p) => ({ title: p.title, company: p.hiringCompany, location: pub.locationText(p), pay: pub.payText(p), path: pub.pathOf(p) }));
}

// Called from the Candidate save hook. Waits a little so a burst of saves is one sweep, and at most one per 5 minutes.
const timers = new Map();
const lastRun = new Map();
function scheduleSweep(candidateId) {
  if (off()) return;
  const id = String(candidateId);
  if (timers.has(id)) return;
  const wait = Math.max(20000, (lastRun.get(id) || 0) + 5 * 60000 - Date.now());
  const timer = setTimeout(async () => {
    timers.delete(id);
    lastRun.set(id, Date.now());
    try { await sweepCandidate(await Candidate.findById(id)); } catch (e) { console.error('Job notice sweep failed:', e.message); }
  }, wait);
  timer.unref();
  timers.set(id, timer);
}

function sweepPostingLater(posting) {
  if (off()) return;
  setImmediate(() => sweepPosting(posting).catch((e) => console.error('Job notice sweep failed:', e.message)));
}

module.exports = { sweepCandidate, sweepPosting, qualifyingJobsFor, scheduleSweep, sweepPostingLater };
