// Matching candidates to a set of required skills (up to 3, each with a minimum level). Used by
// recruiter search now and by job postings later, so the rules live in one place.
//
//  met      shown, at or above the minimum level, result under 12 months old
//  stale    shown and at or above the minimum, but the result needs a retake
//  below    shown but under the minimum level
//  missing  not shown (never tested, or the candidate chose not to show it). This is NOT a "no":
//           the candidate may well have the skill, so these land in partial matches.
//
// A candidate is a full match only when every required skill is "met". Anything else with at least
// one met or stale skill is a partial match.
const LEVELS = ['Foundational', 'Intermediate', 'Advanced', 'Expert'];
const STALE_MS = 365 * 86400000;
const MAX_SKILLS = 3;

// Reads skillKey / skillLevel query values (single values or arrays) into clean requirements.
function parseRequirements(query, validKeys) {
  const keys = [].concat(query.skillKey || []);
  const levels = [].concat(query.skillLevel || []);
  const seen = new Set();
  const out = [];
  keys.forEach((k, i) => {
    if (!validKeys.has(k) || seen.has(k) || out.length >= MAX_SKILLS) return;
    seen.add(k);
    out.push({ key: k, minLevel: LEVELS.includes(levels[i]) ? levels[i] : LEVELS[0] });
  });
  return out;
}

function evaluate(summary, requirements, now = Date.now()) {
  const per = requirements.map((req) => {
    const s = (summary || []).find((x) => x.key === req.key);
    if (!s) return { key: req.key, status: 'missing' };
    if (s.levelIndex < LEVELS.indexOf(req.minLevel) + 1) return { key: req.key, status: 'below', level: s.level, grandmaster: !!s.grandmaster, levelIndex: s.levelIndex };
    const stale = now - new Date(s.takenAt).getTime() > STALE_MS;
    return { key: req.key, status: stale ? 'stale' : 'met', level: s.level, grandmaster: !!s.grandmaster, levelIndex: s.levelIndex };
  });
  const met = per.filter((p) => p.status === 'met').length;
  const stale = per.filter((p) => p.status === 'stale').length;
  return {
    per, full: met === requirements.length, any: met + stale > 0,
    score: met + stale * 0.5,
    levelSum: per.reduce((n, p) => n + ((p.status === 'met' || p.status === 'stale') ? p.levelIndex : 0), 0)
  };
}

// Full matches first, then partial. Within each: higher score, then higher levels.
function compare(a, b) {
  if (a.full !== b.full) return a.full ? -1 : 1;
  return (b.score - a.score) || (b.levelSum - a.levelSum);
}

// Job-title test filter: one title test and a minimum exact score (0-100). Only results the candidate
// chose to show are in titleSummary, and a result over 12 months old needs a retake, so it doesn't count.
function parseTitleFilter(query, validIds) {
  const id = String(query.titleTest || '');
  if (!validIds.has(id)) return null;
  const n = parseInt(query.titleMin, 10);
  return { assessmentId: id, minScore: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0 };
}

function meetsTitle(summary, filter, now = Date.now()) {
  return (summary || []).some((t) => t.assessmentId === filter.assessmentId && t.score >= filter.minScore &&
    now - new Date(t.takenAt).getTime() <= STALE_MS);
}

module.exports = { LEVELS, STALE_MS, MAX_SKILLS, parseRequirements, evaluate, compare, parseTitleFilter, meetsTitle };
