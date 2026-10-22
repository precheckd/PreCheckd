// Turns a Candidate (and a posting's location rule) into the plain "facts" the apply gate reads
// (see the input shapes at the top of services/applyGate.js). The gate itself never touches the
// database; everything that does lives here.
//
//   const facts = await buildCandidateFacts(candidate, { posting, alreadyApplied, blockedByRecruiter });
//   const result = applyGate.evaluate(facts, posting);
//
// posting.areaRule (set from the recruiter's location answers when a posting is saved):
//   { point: [lng, lat] }                     on-site or hybrid address
//   { point: [lng, lat], radiusMiles: n }     Remote in Area, "within n miles of"
//   { states: ['NY', 'NJ'] }                  Remote in Area, state list

const SkillResult = require('../models/SkillResult');
const { areaMatch } = require('../utils/geo');
const { educationFacts } = require('../utils/educationLevel');
const { catalogIdFor, byId } = require('../content/certCatalog');

const DAY = 86400000;
const DEFAULT_RETAKE_DAYS = 60; // mirrors RETAKE_DAYS in services/skills.js, which loadSkillFacts passes in
const CLEARANCE_INDEX = { none: 0, public_trust: 1, secret: 2, top_secret: 3, ts_sci: 4, other: 0 };

// The REAL published level for each skill (including skills the candidate hides from recruiters),
// plus whether a newer attempt is held for integrity review and when a retake is next allowed.
async function loadSkillFacts(candidateId, now = Date.now()) {
  // Loaded here, not at the top, so the pure functions below can be tested without the email service.
  const { currentSkills, RETAKE_DAYS } = require('./skills');
  const [current, rows] = await Promise.all([
    currentSkills(candidateId),
    SkillResult.find({ candidateId, status: 'completed' }).select('skills completedAt held reviewDecision'),
  ]);
  return skillFactsFrom(current, rows, now, RETAKE_DAYS);
}

// Pure part of the above, so it can be tested without a database.
function skillFactsFrom(current, rows, now = Date.now(), retakeDays = DEFAULT_RETAKE_DAYS) {
  const facts = new Map();
  for (const s of current) {
    facts.set(s.key, { key: s.key, label: s.label, level: s.level, takenAt: s.takenAt, reviewing: false, nextAttemptAt: null });
  }
  for (const r of rows) {
    const counted = r.reviewDecision !== 'rejected';
    for (const s of r.skills || []) {
      // A held attempt nobody has decided on yet is "being reviewed".
      if (r.held && !r.reviewDecision) {
        const f = facts.get(s.key) || { key: s.key, label: s.label, level: null, takenAt: null, reviewing: false, nextAttemptAt: null };
        f.reviewing = true;
        facts.set(s.key, f);
      }
      // 60-day retake lock, counted from the last attempt that counted (same rule as nextAllowed).
      if (counted && s.score != null && r.completedAt) {
        const until = new Date(r.completedAt).getTime() + retakeDays * DAY;
        const f = facts.get(s.key);
        if (f && until > now && (!f.nextAttemptAt || until > f.nextAttemptAt.getTime())) f.nextAttemptAt = new Date(until);
      }
    }
  }
  // The gate needs a level and a date to judge a skill; an entry with only a review flag is kept so
  // the "being reviewed" message can show, with level null.
  return [...facts.values()].map((f) => (f.level ? f : { ...f, level: 'Developing', takenAt: f.takenAt || new Date(0) }));
}

function certFacts(certifications) {
  const out = [];
  for (const c of certifications || []) {
    const catalogId = catalogIdFor(c.name);
    if (!catalogId) continue; // not on the catalog: cannot be required, so it cannot count
    out.push({ catalogId, label: byId(catalogId).name, verified: Boolean(c.verified), expiresAt: c.expiresAt || null });
  }
  return out;
}

// Pure: everything except the skill lookup.
function toFacts(candidate, { skills = [], posting = null, alreadyApplied = false, blockedByRecruiter = false, membershipActive } = {}) {
  const arrangement = posting && posting.arrangement;
  const needsArea = arrangement && arrangement !== 'remote';
  return {
    verified: {
      email: Boolean(candidate.emailVerifiedAt),
      phone: Boolean(candidate.isPhoneVerified),
      identity: Boolean(candidate.isIdentityVerified),
    },
    skills,
    education: educationFacts(candidate.educationHistory),
    certs: certFacts(candidate.certifications),
    clearance: CLEARANCE_INDEX[candidate.securityClearance] || 0,
    shifts: Array.isArray(candidate.shifts) ? candidate.shifts : [],
    availableFrom: candidate.availableFrom || null,
    areaMatch: needsArea ? areaMatch(candidate.workAreas, posting.areaRule) : null,
    membershipActive,
    alreadyApplied: Boolean(alreadyApplied),
    blockedByRecruiter: Boolean(blockedByRecruiter),
  };
}

async function buildCandidateFacts(candidate, opts = {}) {
  const skills = await loadSkillFacts(candidate._id, opts.now);
  return toFacts(candidate, { ...opts, skills });
}

module.exports = { buildCandidateFacts, toFacts, skillFactsFrom, certFacts, loadSkillFacts, CLEARANCE_INDEX };
