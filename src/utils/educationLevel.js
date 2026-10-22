// Education levels for the apply gate. A higher level satisfies a lower one.
// The index matches EDUCATION_LEVELS in services/applyGate.js (0 = none).

const LEVELS = [
  { code: 'high_school', index: 1, label: 'High school or GED' },
  { code: 'associate', index: 2, label: 'Associate degree' },
  { code: 'bachelor', index: 3, label: "Bachelor's degree" },
  { code: 'master', index: 4, label: "Master's degree" },
  { code: 'doctorate', index: 5, label: 'Doctorate' },
];
const CODES = LEVELS.map((l) => l.code);

function indexOf(code) {
  const l = LEVELS.find((x) => x.code === code);
  return l ? l.index : 0;
}

// Best guess at a level from the free-text degree an entry already has ("BS Computer Science",
// "M.B.A.", "Associate of Applied Science"). Used only to pre-fill the dropdown on entries saved
// before levels existed; the candidate confirms it, and it is the saved level that the gate reads.
// Returns a level code or null when it cannot tell.
function guessLevel(degree) {
  const raw = String(degree || '').toLowerCase();
  if (!raw.trim()) return null;
  const s = raw.replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  const has = (re) => re.test(s);
  if (has(/\b(phd|doctorate|doctoral|doctor of|edd|dba|jd|md|dnp|psyd)\b/)) return 'doctorate';
  if (has(/\b(master|masters|master's|ms|msc|ma|mba|meng|mfa|mph|msw|mpa|med|mem)\b/)) return 'master';
  if (has(/\b(bachelor|bachelors|bachelor's|bs|bsc|ba|bba|beng|bfa|bsn|btech|ab|sb)\b/)) return 'bachelor';
  if (has(/\b(associate|associates|associate's|aas|as|aa|aos)\b/)) return 'associate';
  if (has(/\b(high school|hs diploma|ged|secondary school)\b/)) return 'high_school';
  return null;
}

// Facts for the gate from a candidate's saved education entries:
//   verifiedLevel = highest level among VERIFIED entries
//   pendingLevel  = highest level among entries not verified yet
// An entry with no saved level falls back to the guess so older entries still count.
function educationFacts(entries) {
  let verified = 0;
  let pending = 0;
  for (const e of entries || []) {
    const idx = indexOf(e.level || guessLevel(e.degree));
    if (!idx) continue;
    if (e.verified) verified = Math.max(verified, idx);
    else pending = Math.max(pending, idx);
  }
  return { verifiedLevel: verified, pendingLevel: pending };
}

module.exports = { LEVELS, CODES, indexOf, guessLevel, educationFacts };
