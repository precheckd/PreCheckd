// Candidate-side shift availability. A candidate ticks the kinds of shift they will work; a recruiter
// (or a job posting) names one shift. This replaced the old week-and-hours picker (availableDays plus
// one start/end window), which was messy to fill in and to search on. The old fields are still on the
// Candidate record but nothing reads them any more.
//
// Same five choices on the candidate profile, the recruiter search and the job posting.

const SHIFT_OPTIONS = [
  { code: 'daytime', label: 'Standard daytime' },
  { code: 'evenings', label: 'Evenings' },
  { code: 'overnight', label: 'Overnight' },
  { code: 'rotating', label: 'Rotating' },
  { code: 'flexible', label: 'Flexible (any shift)' },
];

const SHIFT_CODES = SHIFT_OPTIONS.map((s) => s.code);

function hasSetShifts(candidate) {
  return Array.isArray(candidate.shifts) && candidate.shifts.length > 0;
}

// Returns 'matched' | 'unset' | 'excluded' for a required shift.
//   matched  - they ticked that shift, or Flexible
//   unset    - they never chose any shifts (not a no, so the recruiter can just ask)
//   excluded - they chose shifts and this one is not among them
function candidateShiftGroup(candidate, requiredShift) {
  if (!requiredShift || requiredShift === 'flexible') return 'matched';
  if (!hasSetShifts(candidate)) return 'unset';
  return candidate.shifts.includes(requiredShift) || candidate.shifts.includes('flexible') ? 'matched' : 'excluded';
}

module.exports = { SHIFT_OPTIONS, SHIFT_CODES, hasSetShifts, candidateShiftGroup };
