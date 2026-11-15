// Our own "too good" check, on top of CoderByte's cheating flags. A result that trips it is held for staff
// review (the Integrity Review queue) exactly like a CoderByte flag: nothing is published until a person approves it.
//
// What we can see per attempt: total time taken, number of questions, score and level. CoderByte gives no
// per-question timing, so "uniform pace" can't be measured; average seconds per question is the signal.
// Elapsed time is the LONGER of CoderByte's time_taken and our own start-to-finish clock, so rounding never causes a flag.
// Thresholds can be tuned with env vars without a deploy of code.
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const limits = () => ({
  minQuestions: num(process.env.INTEGRITY_MIN_QUESTIONS, 5),
  fastSeconds: num(process.env.INTEGRITY_FAST_SECONDS, 8),            // any level, with a passing-level score
  fastScore: num(process.env.INTEGRITY_FAST_SCORE, 80),
  hardSeconds: num(process.env.INTEGRITY_HARD_SECONDS, 20),           // Advanced/Expert, near-perfect score
  hardScore: num(process.env.INTEGRITY_HARD_SCORE, 90),
});

function elapsedSeconds(result) {
  const a = Number.isFinite(Number(result.timeTakenMinutes)) && result.timeTakenMinutes != null ? Number(result.timeTakenMinutes) * 60 : null;
  const b = result.startedAt && result.completedAt ? (new Date(result.completedAt) - new Date(result.startedAt)) / 1000 : null;
  const vals = [a, b].filter((x) => x != null && x >= 0);
  return vals.length ? Math.max(...vals) : null;
}

// Percent of questions answered correctly, from the stored outcomes.
function percentRight(result) {
  const answers = result.answers || [];
  if (answers.length) return (100 * answers.filter((q) => q.correct).length) / answers.length;
  return Number.isFinite(Number(result.overallScore)) ? Number(result.overallScore) : null;
}

// Returns a list of plain-English reasons (empty = nothing unusual).
function check(result, assessment) {
  const kind = assessment && assessment.kind;
  if (kind === 'custom') return []; // written answers; speed says little
  const L = limits();
  const n = (result.answers || []).length;
  const secs = elapsedSeconds(result);
  const pct = percentRight(result);
  if (n < L.minQuestions || secs == null || pct == null) return [];
  const per = secs / n;
  const hardLevel = assessment && (assessment.tier === 'hard' || assessment.tier === 'expert');
  const reasons = [];
  if (per < L.fastSeconds && pct >= L.fastScore) reasons.push(`Finished ${n} questions in ${fmt(secs)} (about ${Math.round(per)} seconds each) and got ${Math.round(pct)}% right.`);
  else if (hardLevel && per < L.hardSeconds && pct >= L.hardScore) reasons.push(`Advanced/Expert test finished in ${fmt(secs)} (about ${Math.round(per)} seconds a question) with ${Math.round(pct)}% right.`);
  return reasons;
}
const fmt = (s) => (s < 90 ? `${Math.round(s)} seconds` : `${Math.round(s / 60)} minutes`);

module.exports = { check, elapsedSeconds, percentRight, limits };
