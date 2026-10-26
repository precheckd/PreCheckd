// Sorts the open jobs for a signed-in candidate into "you qualify" and "not yet", using the same apply gate
// that decides whether they can apply, so the list and the apply button never disagree.
const { levelName } = require('../utils/levelName');
const { evaluate } = require('./applyGate');
const { toFacts, loadSkillFacts } = require('./applyFacts');

// One short phrase per blocker for the job list (the full wording is on the job page).
function shortReason(b, posting) {
  const req = (posting.skills || []).find((s) => s.key === b.skillKey);
  const skill = req ? (req.label || req.key) : 'a skill';
  switch (b.code) {
    case 'skill_missing': case 'skill_below': return `Needs ${req && req.minLevel ? levelName(req.minLevel) + ' ' : ''}${skill}`;
    case 'skill_stale': case 'skill_locked': return `Retake ${skill}`;
    case 'skill_reviewing': return `${skill} result in review`;
    case 'education_missing': case 'education_pending': return 'Needs a verified degree';
    case 'cert_missing': case 'cert_expired': case 'cert_unverified': return 'Needs a certification';
    case 'clearance_missing': return 'Needs a clearance';
    case 'shift_missing': return 'Shift does not match';
    case 'area_unset': return 'Set your Work Areas';
    case 'area_outside': return 'Outside your Work Areas';
    case 'availability_late': return 'Start date does not fit';
    case 'not_verified': return 'Finish verifying your account';
    case 'membership_inactive': return 'Membership inactive';
    default: return 'Not eligible yet';
  }
}

// Where each kind of fix lives on the candidate's profile (same places the job page links to).
const SECTION_PATH = { education: '/edit', certifications: '/edit', clearance: '/job-preferences', shifts: '/job-preferences', availability: '/job-preferences', workAreas: '/work-areas' };
function fixHref(b, slug) {
  if (!slug) return null;
  const a = (b.actions || []).find((x) => x.kind === 'start_track' || x.kind === 'edit_profile');
  if (!a) return null;
  if (a.kind === 'start_track') return `/candidate/${slug}/skills`;
  return a.section === 'verification' ? `/candidate/${slug}` : `/candidate/${slug}${SECTION_PATH[a.section] || '/edit'}`;
}

// postings: Mongoose JobPosting docs. appliedIds: Set of job ids the candidate already applied to.
// Returns Map(jobId -> { status: 'fit' | 'applied' | 'blocked', reasons: [], inArea: boolean })
async function classify(candidate, postings, appliedIds, now = Date.now()) {
  const skills = await loadSkillFacts(candidate._id, now);
  const out = new Map();
  for (const p of postings) {
    const id = String(p._id);
    const shape = p.toGateShape();
    const gate = evaluate(toFacts(candidate, { skills, posting: shape }), shape, now);
    // "In my work area": a job with a place (not plain remote) that falls inside the candidate's Work Areas.
    const inArea = shape.arrangement !== 'remote' && !gate.blockers.some((b) => b.criterion === 'area');
    if (appliedIds.has(id)) { out.set(id, { status: 'applied', reasons: [], inArea }); continue; }
    if (gate.canApply) { out.set(id, { status: 'fit', reasons: [], inArea }); continue; }
    const seen = new Set();
    const reasons = [];
    for (const b of gate.blockers) {
      const text = shortReason(b, shape);
      if (seen.has(text)) continue;
      seen.add(text);
      reasons.push({ text, href: fixHref(b, candidate.slug) });
    }
    out.set(id, { status: 'blocked', reasons, inArea });
  }
  return out;
}

module.exports = { classify, shortReason, fixHref };
