// Single source of truth for "has this candidate filled in enough to be
// findable in recruiter search." Kent's call: like a dating app that asks
// real questions instead of letting you skate by with nothing filled in —
// a few required matching fields, not fifty, but they're genuinely
// required (not "unset means no filter"). As more matching fields get
// added later, they join the `requirements` list below and every caller
// of meetsMatchingRequirements()/getMissingMatchingRequirements() picks
// them up automatically — no other file needs to change.
//
// Each requirement's `isMet` takes the full candidate document (not just
// one field) in case a future requirement needs to look at more than one
// value to decide if it's satisfied. `page` is the path segment (under
// /candidate/:slug/) where a candidate goes to fix that requirement, used
// to route the "recruiters can't find you yet" banner straight to the
// right page instead of always landing on Edit Profile.
const requirements = [
  {
    key: 'workAreas',
    label: 'Where you\'re willing to work',
    page: 'work-areas',
    isMet: (candidate) => Boolean(
      candidate.workAreas &&
      candidate.workAreas.coordinates &&
      candidate.workAreas.coordinates.length > 0
    ),
  },
  {
    key: 'minSalary',
    label: 'Minimum salary',
    page: 'job-preferences',
    isMet: (candidate) => Boolean(
      typeof candidate.minSalaryAmount === 'number' && candidate.minSalaryAmount > 0
    ),
  },
  {
    key: 'workArrangement',
    label: 'Work arrangement (remote, hybrid, or in-office)',
    page: 'job-preferences',
    isMet: (candidate) => Boolean(
      Array.isArray(candidate.workArrangement) && candidate.workArrangement.length > 0
    ),
  },
];

function getMissingMatchingRequirements(candidate) {
  return requirements.filter((r) => !r.isMet(candidate)).map((r) => ({ key: r.key, label: r.label, page: r.page }));
}

function candidateMeetsMatchingRequirements(candidate) {
  return requirements.every((r) => r.isMet(candidate));
}

module.exports = { requirements, getMissingMatchingRequirements, candidateMeetsMatchingRequirements };
