// Finalist (second-stage) tests. A recruiter picks exactly 3 of these 5 general topics for a posting, and every
// finalist of that posting takes the one combined CoderByte test that covers those 3 (there are 10 combos).
const TOPICS = [
  { key: 'logic', label: 'Logic' },
  { key: 'problem', label: 'Problem solving' },
  { key: 'time', label: 'Time management' },
  { key: 'detail', label: 'Attention to detail' },
  { key: 'numbers', label: 'Numerical reasoning' },
];
const KEYS = TOPICS.map((t) => t.key);
const PICK = 3;
const label = (key) => (TOPICS.find((t) => t.key === key) || { label: key }).label;

// Unique, valid topic keys from whatever was submitted, in the canonical order.
function normalize(input) {
  const raw = input === undefined || input === null ? [] : Array.isArray(input) ? input : typeof input === 'object' ? Object.values(input) : [input];
  const set = new Set(raw.map((x) => String(x).trim().toLowerCase()));
  return KEYS.filter((k) => set.has(k));
}

// Nothing picked is fine (no finalist stage); anything else must be exactly 3 valid topics.
function validate(input) {
  const raw = input === undefined || input === null ? [] : Array.isArray(input) ? input : typeof input === 'object' ? Object.values(input) : [input];
  const topics = normalize(raw);
  if (raw.filter((x) => String(x).trim()).length !== topics.length && raw.length) return { topics: [], error: 'Choose finalist topics from the list.' };
  if (topics.length && topics.length !== PICK) return { topics: [], error: `Choose exactly ${PICK} finalist topics, or none.` };
  return { topics, error: null };
}

// The CoderByte combo test (SkillAssessment, kind 'finalist') whose three topics match, or null.
const skillKeyOf = (topic) => `finalist-${topic}`;
function matches(assessment, topics) {
  const have = (assessment.skills || []).map((s) => s.key).sort().join('|');
  return have === topics.map(skillKeyOf).sort().join('|');
}

module.exports = { TOPICS, KEYS, PICK, label, normalize, validate, matches, skillKeyOf };
