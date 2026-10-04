// Candidate years of experience — computed from work history, never
// self-declared. Kent's explicit requirement: no claiming 10 years when
// your job history only shows 3, so this is derived, not a form field.
//
// An earlier pass also tried to bucket this into an overall seniority band
// (Entry/Mid/Senior/Lead) and gate search visibility on it. Rolled back
// (Oct 3, 2026) — there's no honest single-number way to tell "25 years as
// a help-desk tech" apart from "25 years heading up infrastructure," and
// Kent's actual plan for that distinction is a per-skill leveling system
// (recruiters pick skills + a required level per skill on a job posting;
// candidates get a level per skill from assessments) rather than one
// overall band. That system doesn't exist yet. Until it does, years stays
// a plain, informational number on the profile — not a gate, not
// self-selected, not banded.
function parseYearMonth(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (!year || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

// Total years of experience = earliest job start to latest job end (or
// now, for a current job) — a career-span calculation, not a sum of each
// job's duration, so overlapping or back-to-back jobs don't double-count.
// Returns { years: Number } or { years: null } when there's no work
// history with a usable start date to compute from.
function computeExperience(workHistory) {
  if (!Array.isArray(workHistory) || workHistory.length === 0) {
    return { years: null };
  }

  const starts = workHistory.map((j) => parseYearMonth(j.startDate)).filter(Boolean);
  if (starts.length === 0) {
    return { years: null };
  }

  const ends = workHistory.map((j) => (j.endDate ? parseYearMonth(j.endDate) : new Date()));
  const validEnds = ends.filter(Boolean);

  const earliestStart = new Date(Math.min(...starts.map((d) => d.getTime())));
  const latestEnd = new Date(Math.max(...(validEnds.length > 0 ? validEnds : [new Date()]).map((d) => d.getTime())));

  const rawYears = (latestEnd.getTime() - earliestStart.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  const years = Math.max(0, Math.round(rawYears * 10) / 10);

  return { years };
}

module.exports = { computeExperience };
