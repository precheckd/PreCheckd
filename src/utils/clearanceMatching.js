// Security clearance for recruiter search. Clearance is reported by the candidate and never verified.
// A candidate appears in clearance searches only if they opted in (showClearanceInSearch). The job
// apply gate does not use this file: it always reads the real reported value.

const CLEARANCE_OPTIONS = [
  { code: 'public_trust', label: 'Public Trust', index: 1 },
  { code: 'secret', label: 'Secret', index: 2 },
  { code: 'top_secret', label: 'Top Secret', index: 3 },
  { code: 'ts_sci', label: 'TS/SCI', index: 4 },
];

function indexOfCode(code) {
  const o = CLEARANCE_OPTIONS.find((c) => c.code === code);
  return o ? o.index : 0; // 'none' and 'other' count as no clearance
}

// 'matched' | 'unset' | 'excluded'
//   matched  - opted in, and holds at least the required level
//   unset    - has not chosen to show a clearance, so the search cannot tell (a recruiter can ask)
//   excluded - opted in, and the level they show is lower than required
function candidateClearanceGroup(candidate, requiredCode) {
  const need = indexOfCode(requiredCode);
  if (!need) return 'matched';
  if (!candidate.showClearanceInSearch) return 'unset';
  return indexOfCode(candidate.securityClearance) >= need ? 'matched' : 'excluded';
}

module.exports = { CLEARANCE_OPTIONS, indexOfCode, candidateClearanceGroup };
