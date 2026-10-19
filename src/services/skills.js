// Candidate-facing skill rules: who can take what, what counts, what recruiters may see.
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const Candidate = require('../models/Candidate');
const coderbyte = require('./coderbyte');

const RETAKE_DAYS = 60;
const STALE_DAYS = 365;
const DAY = 86400000;
const SHOWABLE = new Set(['Foundational', 'Intermediate', 'Advanced', 'Expert']);

const published = (r) => r.status === 'completed' && (!r.held || r.reviewDecision === 'approved');

// Current published result per skill. A retake replaces the earlier result only once the
// 60-day window has passed; a result inside the window of an earlier one is ignored for the
// skills it overlaps (so taking a second test that shares a skill never overwrites it early).
async function currentSkills(candidateId) {
  const results = await SkillResult.find({ candidateId, status: 'completed' }).sort({ completedAt: 1 });
  const out = new Map();
  for (const r of results) {
    if (!published(r)) continue;
    for (const s of r.skills || []) {
      if (s.score == null) continue;
      const prev = out.get(s.key);
      if (prev && r.completedAt.getTime() - prev.takenAt.getTime() < RETAKE_DAYS * DAY) continue;
      out.set(s.key, { key: s.key, label: s.label, level: s.level, score: s.score, weighted: s.weighted, tiers: s.tiers || null,
        takenAt: r.completedAt, stale: Date.now() - r.completedAt.getTime() > STALE_DAYS * DAY });
    }
  }
  return [...out.values()];
}

// What a recruiter may see: levels only, honouring the candidate's choices.
async function recruiterView(candidate) {
  const all = await currentSkills(candidate._id);
  const hidden = new Set(candidate.hiddenSkillKeys || []);
  // Developing and Provisional results are never shown to recruiters; they still count as tested.
  const shown = all.filter((s) => !hidden.has(s.key) && SHOWABLE.has(s.level))
    .map((s) => ({ key: s.key, label: s.label, level: s.level, needsRetake: s.stale }));
  return { tested: all.length, shown };
}

// Date this assessment can next be taken, or null if allowed now. A skill is locked for 60 days
// after its last completed attempt; the assessment is open as long as at least one of its skills
// is not locked (so a test that shares one skill with an earlier test can still be taken).
async function nextAllowed(candidateId, assessment) {
  const keys = (assessment.skills || []).map((s) => s.key);
  const done = await SkillResult.find({ candidateId, status: 'completed', 'skills.key': { $in: keys } });
  const unlock = keys.map((k) => {
    const last = done.filter((r) => (r.skills || []).some((s) => s.key === k && s.score != null) && r.completedAt)
      .reduce((m, r) => Math.max(m, r.completedAt.getTime()), 0);
    return last ? last + RETAKE_DAYS * DAY : 0;
  });
  const earliest = Math.min(...unlock);
  return earliest > Date.now() ? new Date(earliest) : null;
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

module.exports = { SHOWABLE, RETAKE_DAYS, STALE_DAYS, published, currentSkills, recruiterView, nextAllowed, startAttempt, setHidden };
