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
// value to decide if it's satisfied.
const requirements = [
  {
    key: 'workAreas',
    label: 'Where you\'re willing to work',
    isMet: (candidate) => Boolean(
      candidate.workAreas &&
      candidate.workAreas.coordinates &&
      candidate.workAreas.coordinates.length > 0
    ),
  },
  {
    key: 'minSalary',
    label: 'Minimum salary',
    isMet: (candidate) => Boolean(
      typeof candidate.minSalaryAmount === 'number' && candidate.minSalaryAmount > 0
    ),
  },
  {
    key: 'experience',
    label: 'Work history with at least one dated job (used to compute your experience level)',
    // experienceBand is computed on save from workHistory — see
    // utils/experienceLevel.js — so this is really checking "do you have
    // at least one work-history entry with a usable start date," not
    // asking the candidate to fill in a number themselves.
    isMet: (candidate) => Boolean(candidate.experienceBand),
  },
];

function getMissingMatchingRequirements(candidate) {
  return requirements.filter((r) => !r.isMet(candidate)).map((r) => ({ key: r.key, label: r.label }));
}

function candidateMeetsMatchingRequirements(candidate) {
  return requirements.every((r) => r.isMet(candidate));
}

module.exports = { requirements, getMissingMatchingRequirements, candidateMeetsMatchingRequirements };
