// Candidate-side weekly availability (optional — see
// candidateMatchingRequirements.js for the separate, required fields).
// A candidate picks which days they're free and ONE start/end time window
// that applies across those days (Kent's "9-2 M-F, school hours" case).
// Recruiters optionally state a role's required days/hours at search
// time; candidates are grouped (not simply filtered) based on whether
// their stated window covers it — see candidateAvailabilityGroup below.

const DAY_OPTIONS = [
  { code: 'mon', label: 'Mon' },
  { code: 'tue', label: 'Tue' },
  { code: 'wed', label: 'Wed' },
  { code: 'thu', label: 'Thu' },
  { code: 'fri', label: 'Fri' },
  { code: 'sat', label: 'Sat' },
  { code: 'sun', label: 'Sun' },
];

const DAY_CODES = DAY_OPTIONS.map((d) => d.code);

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60) + m;
}

function hasSetAvailability(candidate) {
  return Boolean(
    Array.isArray(candidate.availableDays) && candidate.availableDays.length > 0 &&
    candidate.availableStartTime && candidate.availableEndTime
  );
}

// Does the candidate's recurring daily window (candStart-candEnd) fully
// contain the required window (reqStart-reqEnd)? All four are minutes
// since midnight (0-1439). An end time <= its own start time means the
// window wraps past midnight (an overnight shift) — handled by shifting
// both windows onto the same circular clock anchored at the candidate's
// start time, rather than assuming either window sits within one calendar
// day.
function windowContains(candStart, candEnd, reqStart, reqEnd) {
  const candDuration = candEnd <= candStart ? (candEnd + 1440) - candStart : candEnd - candStart;
  const reqDuration = reqEnd <= reqStart ? (reqEnd + 1440) - reqStart : reqEnd - reqStart;

  // Shift the required window so it's expressed as an offset from the
  // candidate's start time, on the same circular (mod-1440) clock.
  const reqStartShifted = ((reqStart - candStart) % 1440 + 1440) % 1440;
  const reqEndShifted = reqStartShifted + reqDuration;

  return reqStartShifted >= 0 && reqEndShifted <= candDuration;
}

// Returns 'matched' | 'unset' | 'excluded'. Callers filter out 'excluded'
// entirely and sort 'matched' before 'unset' — see candidate-search.js.
function candidateAvailabilityGroup(candidate, requiredDays, requiredStartTime, requiredEndTime) {
  if (!hasSetAvailability(candidate)) return 'unset';

  const daysOk = requiredDays.every((d) => candidate.availableDays.includes(d));
  if (!daysOk) return 'excluded';

  const covers = windowContains(
    timeToMinutes(candidate.availableStartTime),
    timeToMinutes(candidate.availableEndTime),
    timeToMinutes(requiredStartTime),
    timeToMinutes(requiredEndTime)
  );

  return covers ? 'matched' : 'excluded';
}

module.exports = {
  DAY_OPTIONS,
  DAY_CODES,
  hasSetAvailability,
  windowContains,
  candidateAvailabilityGroup,
};
