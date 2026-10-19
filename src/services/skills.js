// Candidate-facing skill rules: who can take what, what counts, what recruiters may see.
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const Candidate = require('../models/Candidate');
const coderbyte = require('./coderbyte');

const RETAKE_DAYS = 60;
const STALE_DAYS = 365;
const DAY = 86400000;

const published = (r) => r.status === 'completed' && (!r.held || r.reviewDecision === 'approved');

// Latest published result per skill key (a retake replaces the earlier score).
async function currentSkills(candidateId) {
  const results = await SkillResult.find({ candidateId, status: 'completed' }).sort({ completedAt: 1 });
  const out = new Map();
  for (const r of results) {
    if (!published(r)) continue;
    for (const s of r.skills || []) {
      if (s.score == null) continue;
      out.set(s.key, { key: s.key, label: s.label, level: s.level, score: s.score, weighted: s.weighted,
        takenAt: r.completedAt, stale: Date.now() - r.completedAt.getTime() > STALE_DAYS * DAY });
    }
  }
  return [...out.values()];
}

// What a recruiter may see: levels only, honouring the candidate's choices.
async function recruiterView(candidate) {
  const all = await currentSkills(candidate._id);
  const hidden = new Set(candidate.hiddenSkillKeys || []);
  const shown = all.filter((s) => !hidden.has(s.key))
    .map((s) => ({ key: s.key, label: s.label, level: s.level, needsRetake: s.stale }));
  return { tested: all.length, shown };
}

// Date this assessment can next be taken, or null if allowed now. Rule: one attempt per skill
// per 60 days, counted from the last completed attempt covering any of the assessment's skills.
async function nextAllowed(candidateId, assessment) {
  const keys = (assessment.skills || []).map((s) => s.key);
  const last = await SkillResult.findOne({ candidateId, status: 'completed', 'skills.key': { $in: keys } })
    .sort({ completedAt: -1 });
  if (!last || !last.completedAt) return null;
  const next = new Date(last.completedAt.getTime() + RETAKE_DAYS * DAY);
  return next > new Date() ? next : null;
}

// Reuse a live invite, otherwise issue a fresh one. Throws with .code 'retake_wait' if too soon.
async function startAttempt(candidate, assessmentId) {
  const assessment = await SkillAssessment.findOne({ assessmentId, active: true });
  if (!assessment) { const e = new Error('Assessment not available'); e.code = 'not_found'; throw e; }
  const wait = await nextAllowed(candidate._id, assessment);
  if (wait) { const e = new Error('Retake not yet allowed'); e.code = 'retake_wait'; e.until = wait; throw e; }
  const live = await SkillResult.findOne({
    candidateId: candidate._id, assessmentId, status: { $in: ['invited', 'started'] }, expiresAt: { $gt: new Date() }
  }).sort({ invitedAt: -1 });
  return live || coderbyte.inviteCandidate({ candidate, assessment });
}

async function setHidden(candidate, shownKeys) {
  const all = await currentSkills(candidate._id);
  const shown = new Set(shownKeys);
  candidate.hiddenSkillKeys = all.filter((s) => !shown.has(s.key)).map((s) => s.key);
  await candidate.save();
}

module.exports = { RETAKE_DAYS, STALE_DAYS, published, currentSkills, recruiterView, nextAllowed, startAttempt, setHidden };
