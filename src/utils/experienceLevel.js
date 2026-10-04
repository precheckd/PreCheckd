// Candidate experience level — computed from work history, never
// self-declared. Kent's explicit requirement: no claiming 10 years when
// your job history only shows 3, so this is derived, not a form field.
//
// This also exists to feed the Job Board pillar (not built yet): once
// recruiters can post a job capped at a level (e.g. "Entry Level" can
// only require 0-1 years), a candidate's computed band is what gets
// compared against it. Locked rule for that future flow (documented here
// since there's no application system yet to enforce it in): a candidate
// can apply DOWN (apply to a job below their own band) but is blocked
// from applying UP (a job above their band) — Kent would rather over-block
// up front than have people apply to jobs they'll never get.
const EXPERIENCE_BANDS = [
  { code: 'entry', label: 'Entry Level', minYears: 0, maxYears: 2 },   // 0-1 years
  { code: 'mid', label: 'Mid Level', minYears: 2, maxYears: 5 },        // 2-4 years
  { code: 'senior', label: 'Senior', minYears: 5, maxYears: 8 },        // 5-7 years
  { code: 'lead', label: 'Lead / Principal', minYears: 8, maxYears: Infinity }, // 8+ years
];

const BAND_CODES = EXPERIENCE_BANDS.map((b) => b.code);

function bandRank(bandCode) {
  return BAND_CODES.indexOf(bandCode);
}

function bandForYears(years) {
  const band = EXPERIENCE_BANDS.find((b) => years >= b.minYears && years < b.maxYears);
  return band ? band.code : 'lead';
}

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
// Returns { years: Number, band: String } or { years: null, band: null }
// when there's no work history with a usable start date to compute from.
function computeExperience(workHistory) {
  if (!Array.isArray(workHistory) || workHistory.length === 0) {
    return { years: null, band: null };
  }

  const starts = workHistory.map((j) => parseYearMonth(j.startDate)).filter(Boolean);
  if (starts.length === 0) {
    return { years: null, band: null };
  }

  const ends = workHistory.map((j) => (j.endDate ? parseYearMonth(j.endDate) : new Date()));
  const validEnds = ends.filter(Boolean);

  const earliestStart = new Date(Math.min(...starts.map((d) => d.getTime())));
  const latestEnd = new Date(Math.max(...(validEnds.length > 0 ? validEnds : [new Date()]).map((d) => d.getTime())));

  const rawYears = (latestEnd.getTime() - earliestStart.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  const years = Math.max(0, Math.round(rawYears * 10) / 10);

  return { years, band: bandForYears(years) };
}

module.exports = { EXPERIENCE_BANDS, BAND_CODES, bandRank, bandForYears, computeExperience };
