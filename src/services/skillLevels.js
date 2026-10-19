// Turns a 0-100 skill score into a level label. Bands are a starting point to tune
// once real results exist; they live here so there is one place to change them.
const WEIGHTS = { easy: 1, medium: 2, hard: 3 };

const BANDS = [
  { min: 90, level: 'Expert' },
  { min: 70, level: 'Advanced' },
  { min: 40, level: 'Intermediate' },
  { min: 0, level: 'Foundational' }
];

function levelFor(score) {
  if (!Number.isFinite(score)) return null;
  return BANDS.find((b) => score >= b.min).level;
}

// answers: [{ id, correct, tags }]   difficultyById: Map(id -> 'easy'|'medium'|'hard')
// ratingKeys: CoderByte rating names that belong to this skill.
// Returns null unless EVERY question for the skill has a known difficulty, because a
// partly weighted score would not be comparable with a fully weighted one.
function weightedSkill(answers, difficultyById, ratingKeys) {
  const keys = new Set(ratingKeys);
  const seen = new Set();
  const qs = answers.filter((a) => {
    if (seen.has(a.id) || !(a.tags || []).some((t) => keys.has(t))) return false;
    seen.add(a.id);
    return true;
  });
  if (!qs.length) return null;
  const tiers = { easy: { right: 0, total: 0 }, medium: { right: 0, total: 0 }, hard: { right: 0, total: 0 } };
  let earned = 0;
  let possible = 0;
  for (const q of qs) {
    const d = difficultyById.get(q.id);
    if (!d) return null;
    tiers[d].total += 1;
    possible += WEIGHTS[d];
    if (q.correct) { tiers[d].right += 1; earned += WEIGHTS[d]; }
  }
  const score = Math.round((earned / possible) * 100);
  return { score, tiers, level: levelFor(score) };
}

module.exports = { WEIGHTS, BANDS, levelFor, weightedSkill };
