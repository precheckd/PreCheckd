// Skill LEVELS come from which difficulty tiers a candidate passed, not from a percentage, so a
// score is never read as a grade. A tier is "assessed" with at least MIN_TIER questions for the
// skill and "passed" when at least PASS_RATIO of them are right. Fewer than two assessed tiers
// is not enough evidence for a level, so the skill is "Provisional".
require('../utils/levelName');
const WEIGHTS = { easy: 1, medium: 2, hard: 3, expert: 3 };
const PASS_RATIO = 0.8; // raised from 0.6 on Oct 22 (a guesser clears 3 of 5 about 10% of the time, 4 of 5 under 2%): 4 of 5, 3 of 3 or 4 of 4 passes a tier
const MIN_TIER = 2;
const ADVANCED_RATIO = 1 / 3; // share of hard questions right that makes Advanced once the medium tier is passed
const TIER_ORDER = ['easy', 'medium', 'hard'];
const TIER_NAMES = { easy: 'Basic', medium: 'Intermediate', hard: 'Advanced', expert: 'Expert exam' }; // names of the tests on a ladder
// The Expert exam is a fourth, separate test (20 questions drawn from a bank of 30) open once a candidate has
// Advanced. 19 of 20 earns Master (stored level 'Expert'); a perfect score also earns the Grandmaster badge.
const LADDER_ORDER = [...TIER_ORDER, 'expert'];
const EXPERT_RATIO = 0.95;
const MIN_EXPERT = 10; // questions needed for the exam to count (a normal exam has 20)
const EXPERT_RETAKE_DAYS = 90;
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

// The Expert exam has its own, much higher line: 19 of 20 (95%), and it needs a real-sized exam.
function expertPassed(tier) {
  return !!tier && tier.total >= MIN_EXPERT && tier.right / tier.total >= EXPERT_RATIO - 1e-9;
}
// A perfect Expert exam earns the Grandmaster badge on top of Master.
function isGrandmaster(tier) {
  return expertPassed(tier) && tier.right === tier.total;
}

// `ladder` is for skills tested one tier at a time (Basic, then Intermediate, then Advanced): a tier
// not attempted yet is simply not reached, so one assessed tier is enough for a level. A combined
// test with a single assessed tier is still too little evidence and stays Provisional.
function levelFromTiers(tiers, { ladder = false } = {}) {
  if (!tiers) return 'Provisional';
  const t = (n) => tiers[n] || { right: 0, total: 0 };
  const assessed = (n) => t(n).total >= MIN_TIER;
  const passed = (n) => tierPassed(tiers[n]);
  const exam = tiers.expert || { right: 0, total: 0 };
  // The Expert exam on its own (one test of a ladder): Master if passed, else nothing earned from it.
  if (exam.total > 0 && !TIER_ORDER.some(assessed)) return ladder ? (expertPassed(exam) ? 'Expert' : 'Developing') : 'Provisional';
  if (TIER_ORDER.filter(assessed).length < (ladder ? 1 : 2)) return 'Provisional';
  const mediumOk = !assessed('medium') || passed('medium');
  const advanced = (passed('hard') && mediumOk)
    || (passed('medium') && t('hard').total > 0 && t('hard').right / t('hard').total >= ADVANCED_RATIO - 1e-9);
  // Master (stored as 'Expert') needs Advanced first and then the separate Expert exam.
  if (advanced) return expertPassed(exam) ? 'Expert' : 'Advanced';
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
    if (seen.has(a.id)) return false;
    // A ladder test covers one skill, so every question counts even when CoderByte reports no tags
    // (custom questions come back untagged).
    if (!opts.allQuestions && !(a.tags || []).some((t) => keys.has(t))) return false;
    seen.add(a.id);
    return true;
  });
  if (!qs.length) return null;
  const tiers = { easy: { right: 0, total: 0 }, medium: { right: 0, total: 0 }, hard: { right: 0, total: 0 }, expert: { right: 0, total: 0 } };
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
  const ratio = level === 'Advanced' ? ADVANCED_RATIO : level === 'Expert' ? EXPERT_RATIO : PASS_RATIO;
  return Math.max(1, Math.ceil(ratio * total - 1e-9));
}

// For the candidate's own experience bar: the next level, which rung earns it, and how far along they are
// (right answers out of the number needed, never a percentage score). Returns null once at the top.
const NEXT_LEVEL = { Developing: 'Foundational', Foundational: 'Intermediate', Intermediate: 'Advanced', Advanced: 'Expert' };
const EARNED_ON = { Foundational: 'easy', Intermediate: 'medium', Advanced: 'hard', Expert: 'expert' };
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

module.exports = { LADDER_ORDER, EXPERT_RATIO, MIN_EXPERT, EXPERT_RETAKE_DAYS, expertPassed, isGrandmaster, WEIGHTS, BANDS, LEVELS, PASS_RATIO, MIN_TIER, ADVANCED_RATIO, TIER_ORDER, TIER_NAMES, levelFor, levelFromTiers, tierPassed, neededFor, nextLevelProgress, scoreFromTiers, weightedSkill };
