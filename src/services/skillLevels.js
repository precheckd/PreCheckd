// Skill LEVELS come from which difficulty tiers a candidate passed, not from a percentage, so a
// score is never read as a grade. A tier is "assessed" with at least MIN_TIER questions for the
// skill and "passed" when at least PASS_RATIO of them are right. Fewer than two assessed tiers
// is not enough evidence for a level, so the skill is "Provisional".
const WEIGHTS = { easy: 1, medium: 2, hard: 3 };
const PASS_RATIO = 0.6; // 2 of 3, 3 of 4 or 3 of 5 passes a tier
const MIN_TIER = 2;
const ADVANCED_RATIO = 1 / 3; // share of hard questions right that makes Advanced once the medium tier is passed
const TIER_ORDER = ['easy', 'medium', 'hard'];
const TIER_NAMES = { easy: 'Basic', medium: 'Intermediate', hard: 'Advanced' }; // names of the three tests on a ladder
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

// Did this tier reach the pass line? Needs at least MIN_TIER questions asked.
function tierPassed(tier) {
  return !!tier && tier.total >= MIN_TIER && tier.right / tier.total >= PASS_RATIO - 1e-9;
}

// `ladder` is for skills tested one tier at a time (Basic, then Intermediate, then Advanced): a tier
// not attempted yet is simply not reached, so one assessed tier is enough for a level. A combined
// test with a single assessed tier is still too little evidence and stays Provisional.
function levelFromTiers(tiers, { ladder = false } = {}) {
  if (!tiers) return 'Provisional';
  const t = (n) => tiers[n] || { right: 0, total: 0 };
  const assessed = (n) => t(n).total >= MIN_TIER;
  const passed = (n) => tierPassed(tiers[n]);
  if (TIER_ORDER.filter(assessed).length < (ladder ? 1 : 2)) return 'Provisional';
  const mediumOk = !assessed('medium') || passed('medium');
  if (passed('hard') && mediumOk) return 'Expert';
  if (passed('medium') && t('hard').total > 0 && t('hard').right / t('hard').total >= ADVANCED_RATIO - 1e-9) return 'Advanced';
  if (passed('medium')) return 'Intermediate';
  if (passed('easy')) return 'Foundational';
  return 'Developing';
}

// answers: [{ id, correct, tags }]   difficultyById: Map(id -> 'easy'|'medium'|'hard')
// ratingKeys: CoderByte rating names that belong to this skill.
// Returns null unless EVERY question for the skill has a known difficulty, because a
// partly weighted score would not be comparable with a fully weighted one.
function weightedSkill(answers, difficultyById, ratingKeys, opts = {}) {
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
  return { score, tiers, level: levelFromTiers(tiers, opts) };
}

// How many right answers a tier needs to reach a level: the pass line, or the Advanced line for the hard tier.
function neededFor(level, total) {
  const ratio = level === 'Advanced' ? ADVANCED_RATIO : PASS_RATIO;
  return Math.max(1, Math.ceil(ratio * total - 1e-9));
}

// For the candidate's own experience bar: the next level, which rung earns it, and how far along they are
// (right answers out of the number needed, never a percentage score). Returns null once at the top.
const NEXT_LEVEL = { Developing: 'Foundational', Foundational: 'Intermediate', Intermediate: 'Advanced', Advanced: 'Expert' };
const EARNED_ON = { Foundational: 'easy', Intermediate: 'medium', Advanced: 'hard', Expert: 'hard' };
function nextLevelProgress(level, tiers) {
  const next = NEXT_LEVEL[level || 'Developing'];
  if (!next) return null;
  const tier = EARNED_ON[next];
  const x = tiers && tiers[tier];
  if (!x || !x.total) return { next, tier, started: false, needed: null, right: 0, fill: 0 };
  const needed = neededFor(next, x.total);
  return { next, tier, started: true, needed, right: x.right, total: x.total, fill: Math.min(1, x.right / needed) };
}

// Internal 0-100 score from tier counts (ranking tiebreaks only), counting just the tiers attempted.
function scoreFromTiers(tiers) {
  let earned = 0;
  let possible = 0;
  for (const n of TIER_ORDER) {
    const x = (tiers && tiers[n]) || { right: 0, total: 0 };
    earned += x.right * WEIGHTS[n];
    possible += x.total * WEIGHTS[n];
  }
  return possible ? Math.round((earned / possible) * 100) : null;
}

module.exports = { WEIGHTS, BANDS, LEVELS, PASS_RATIO, MIN_TIER, ADVANCED_RATIO, TIER_ORDER, TIER_NAMES, levelFor, levelFromTiers, tierPassed, neededFor, nextLevelProgress, scoreFromTiers, weightedSkill };
