// Skill LEVELS come from which difficulty tiers a candidate passed, not from a percentage, so a
// score is never read as a grade. A tier is "assessed" with at least MIN_TIER questions for the
// skill and "passed" when at least PASS_RATIO of them are right. Fewer than two assessed tiers
// is not enough evidence for a level, so the skill is "Provisional".
const WEIGHTS = { easy: 1, medium: 2, hard: 3 };
const PASS_RATIO = 0.6; // 2 of 3, 3 of 4 or 3 of 5 passes a tier
const MIN_TIER = 2;
const LEVELS = ['Developing', 'Foundational', 'Intermediate', 'Advanced', 'Expert'];

// Kept for the internal 0-100 score (ranking tiebreaks); never shown as a level or to recruiters.
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

function levelFromTiers(tiers) {
  if (!tiers) return 'Provisional';
  const t = (n) => tiers[n] || { right: 0, total: 0 };
  const assessed = (n) => t(n).total >= MIN_TIER;
  const passed = (n) => assessed(n) && t(n).right / t(n).total >= PASS_RATIO - 1e-9;
  if (['easy', 'medium', 'hard'].filter(assessed).length < 2) return 'Provisional';
  const mediumOk = !assessed('medium') || passed('medium');
  if (passed('hard') && mediumOk) return 'Expert';
  if (passed('medium') && t('hard').right >= 1) return 'Advanced';
  if (passed('medium')) return 'Intermediate';
  if (passed('easy')) return 'Foundational';
  return 'Developing';
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
  return { score, tiers, level: levelFromTiers(tiers) };
}

module.exports = { WEIGHTS, BANDS, LEVELS, PASS_RATIO, MIN_TIER, levelFor, levelFromTiers, weightedSkill };
