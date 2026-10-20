// Candidate-facing skill rules: who can take what, what counts, what recruiters may see.
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const Candidate = require('../models/Candidate');
const SkillRequest = require('../models/SkillRequest');
const coderbyte = require('./coderbyte');
const { deliver } = require('./skillNotifications');
const { levelFromTiers, tierPassed, scoreFromTiers, TIER_ORDER, TIER_NAMES } = require('./skillLevels');

const RETAKE_DAYS = 60;
const STALE_DAYS = 365;
const DAY = 86400000;
const SHOWABLE = new Set(['Foundational', 'Intermediate', 'Advanced', 'Expert']);

const isTitle = (a) => !!a && a.kind === 'title';
const published = (r) => r.status === 'completed' && (!r.held || r.reviewDecision === 'approved');

async function assessmentsById() {
  return new Map((await SkillAssessment.find({})).map((a) => [a.assessmentId, a]));
}

// Current published result per skill. A retake replaces the earlier result only once the
// 60-day window has passed; a result inside the window of an earlier one is ignored for the
// skills it overlaps (so taking a second test that shares a skill never overwrites it early).
async function currentSkills(candidateId) {
  const results = await SkillResult.find({ candidateId, status: 'completed' }).sort({ completedAt: 1 });
  const asms = await assessmentsById();
  const out = new Map();
  const ladder = new Map(); // skill key -> { label, byTier: { easy: { right, total, takenAt }, ... } }
  for (const r of results) {
    const asm = asms.get(r.assessmentId);
    if (!published(r) || isTitle(asm)) continue;
    if (asm && asm.tier) {
      // One rung of a skill's ladder. The latest result per tier counts, under the same 60-day rule.
      const s = (r.skills || [])[0];
      const x = s && s.tiers && s.tiers[asm.tier];
      if (!x) continue;
      const entry = ladder.get(s.key) || { key: s.key, label: s.label, byTier: {} };
      const prev = entry.byTier[asm.tier];
      if (!(prev && r.completedAt.getTime() - prev.takenAt.getTime() < RETAKE_DAYS * DAY)) {
        entry.byTier[asm.tier] = { right: x.right, total: x.total, takenAt: r.completedAt };
      }
      ladder.set(s.key, entry);
      continue;
    }
    for (const s of r.skills || []) {
      if (s.score == null) continue;
      const prev = out.get(s.key);
      if (prev && r.completedAt.getTime() - prev.takenAt.getTime() < RETAKE_DAYS * DAY) continue;
      out.set(s.key, { key: s.key, label: s.label, level: s.level, score: s.score, weighted: s.weighted, tiers: s.tiers || null,
        takenAt: r.completedAt, stale: Date.now() - r.completedAt.getTime() > STALE_DAYS * DAY });
    }
  }
  for (const e of ladder.values()) {
    const tiers = {};
    for (const n of TIER_ORDER) if (e.byTier[n]) tiers[n] = { right: e.byTier[n].right, total: e.byTier[n].total };
    const level = levelFromTiers(tiers, { ladder: true });
    // Freshness follows the rung that earned the level (Basic, Intermediate, or Advanced), not the newest attempt.
    const earning = { Foundational: 'easy', Intermediate: 'medium', Advanced: 'hard', Expert: 'hard' }[level];
    const stamps = TIER_ORDER.filter((n) => e.byTier[n]).map((n) => e.byTier[n].takenAt.getTime());
    const takenAt = new Date(earning && e.byTier[earning] ? e.byTier[earning].takenAt : Math.max(...stamps));
    const prev = out.get(e.key);
    if (prev && prev.takenAt.getTime() > takenAt.getTime()) continue; // a newer combined-test result wins
    out.set(e.key, { key: e.key, label: e.label, level, score: scoreFromTiers(tiers), weighted: true, tiers, ladder: true,
      takenAt, stale: Date.now() - takenAt.getTime() > STALE_DAYS * DAY });
  }
  return [...out.values()];
}

// The rungs of each skill's ladder for the candidate's Skills page, built from the page's per-assessment
// cards and current results. A rung is passed, locked (the one below isn't passed yet), or open.
function buildLadders(cards, current) {
  const byKey = new Map(current.map((s) => [s.key, s]));
  const groups = new Map();
  for (const c of cards) {
    const a = c.assessment;
    if (!a.tier || a.kind === 'title') continue;
    const sk = (a.skills || [])[0];
    if (!sk) continue;
    const g = groups.get(sk.key) || { key: sk.key, label: sk.label, rungs: [] };
    g.rungs.push({ ...c, tier: a.tier, tierName: TIER_NAMES[a.tier], questions: (a.questions || []).length || null });
    groups.set(sk.key, g);
  }
  return [...groups.values()].map((g) => {
    const cur = byKey.get(g.key);
    const tiers = (cur && cur.tiers) || {};
    g.rungs.sort((x, y) => TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier));
    g.rungs.forEach((r, i) => {
      r.passed = tierPassed(tiers[r.tier]);
      const below = g.rungs[i - 1];
      r.locked = !!below && !tierPassed(tiers[below.tier]);
      r.result = tiers[r.tier] || null;
    });
    g.level = cur ? cur.level : null;
    return g;
  });
}

// Latest published job-title test result per title test, with the exact score and enough context
// to read it: questions right out of total, and the tier breakdown when every question's
// difficulty is recorded.
function titleSummary(result, assessment) {
  const answers = result.answers || [];
  const diff = new Map(((assessment && assessment.questions) || []).map((q) => [String(q.id), q.difficulty]));
  let tiers = null;
  if (answers.length && answers.every((a) => diff.has(a.id))) {
    tiers = { easy: { right: 0, total: 0 }, medium: { right: 0, total: 0 }, hard: { right: 0, total: 0 } };
    for (const a of answers) { const t = tiers[diff.get(a.id)]; t.total += 1; if (a.correct) t.right += 1; }
  }
  return {
    assessmentId: result.assessmentId, name: (assessment && assessment.name) || 'Job title assessment',
    score: result.overallScore, right: answers.filter((a) => a.correct).length, total: answers.length, tiers,
    takenAt: result.completedAt, stale: Date.now() - result.completedAt.getTime() > STALE_DAYS * DAY,
    showOnProfile: !!result.showOnProfile, resultId: result._id, result
  };
}

async function titleResults(candidateId) {
  const [results, asms] = await Promise.all([
    SkillResult.find({ candidateId, status: 'completed' }).sort({ completedAt: 1 }), assessmentsById()
  ]);
  const latest = new Map();
  for (const r of results) {
    const a = asms.get(r.assessmentId);
    if (isTitle(a) && published(r) && r.overallScore != null) latest.set(r.assessmentId, titleSummary(r, a));
  }
  return [...latest.values()];
}

async function setTitleVisibility(candidate, shownAssessmentIds) {
  const shown = new Set(shownAssessmentIds);
  for (const t of await titleResults(candidate._id)) {
    t.result.showOnProfile = shown.has(t.assessmentId);
    await t.result.save();
  }
  await refreshSkillSummary(candidate);
}

// What a recruiter may see: levels only, honouring the candidate's choices.
async function recruiterView(candidate) {
  const all = await currentSkills(candidate._id);
  const hidden = new Set(candidate.hiddenSkillKeys || []);
  // Developing and Provisional results are never shown to recruiters; they still count as tested.
  const shown = all.filter((s) => !hidden.has(s.key) && SHOWABLE.has(s.level))
    .map((s) => ({ key: s.key, label: s.label, level: s.level, needsRetake: s.stale,
      tiers: candidate.showSkillBreakdown && s.tiers ? s.tiers : null }));
  const titles = (await titleResults(candidate._id)).filter((t) => t.showOnProfile)
    .map(({ result, resultId, showOnProfile, ...t }) => t);
  return { tested: all.length, shown, titles };
}

const REJECT_COOLDOWN_DAYS = 14;
const MAX_REJECTIONS = 2;

async function completedFor(candidateId, assessment) {
  // A title test or one rung of a ladder is its own thing: other tiers of the same skill don't count against it.
  if (isTitle(assessment) || assessment.tier) return SkillResult.find({ candidateId, assessmentId: assessment.assessmentId, status: 'completed' });
  const keys = (assessment.skills || []).map((s) => s.key);
  return SkillResult.find({ candidateId, status: 'completed', 'skills.key': { $in: keys } });
}

// A rejected attempt does not start the 60-day lock; it starts a short cooldown instead.
// Two uncleared rejections need staff before another try (see manualHold).
async function manualHold(candidateId, assessment) {
  const done = await completedFor(candidateId, assessment);
  return done.filter((r) => r.reviewDecision === 'rejected' && !r.rejectionCleared).length >= MAX_REJECTIONS;
}

// Date this assessment can next be taken, or null if allowed now. A skill is locked for 60 days
// after its last counted attempt; the assessment is open as long as at least one of its skills
// is not locked (so a test that shares one skill with an earlier test can still be taken).
async function nextAllowed(candidateId, assessment) {
  const done = await completedFor(candidateId, assessment);
  const counted = done.filter((r) => r.reviewDecision !== 'rejected');
  const lastRejected = done.filter((r) => r.reviewDecision === 'rejected' && r.reviewedAt)
    .reduce((m, r) => Math.max(m, r.reviewedAt.getTime()), 0);
  const cooldown = lastRejected ? lastRejected + REJECT_COOLDOWN_DAYS * DAY : 0;
  let lockUntil;
  if (isTitle(assessment)) {
    const last = counted.reduce((m, r) => Math.max(m, r.completedAt ? r.completedAt.getTime() : 0), 0);
    lockUntil = last ? last + RETAKE_DAYS * DAY : 0;
  } else {
    const keys = (assessment.skills || []).map((s) => s.key);
    lockUntil = Math.min(...keys.map((k) => {
      const last = counted.filter((r) => (r.skills || []).some((s) => s.key === k && s.score != null) && r.completedAt)
        .reduce((m, r) => Math.max(m, r.completedAt.getTime()), 0);
      return last ? last + RETAKE_DAYS * DAY : 0;
    }));
  }
  const until = Math.max(lockUntil, cooldown);
  return until > Date.now() ? new Date(until) : null;
}

// Reuse a live invite, otherwise issue a fresh one. Throws with .code 'retake_wait' if too soon.
async function startAttempt(candidate, assessmentId) {
  const assessment = await SkillAssessment.findOne({ assessmentId, active: true });
  if (!assessment) { const e = new Error('Assessment not available'); e.code = 'not_found'; throw e; }
  if (assessment.tier && assessment.tier !== 'easy') {
    // Each rung opens once the one below it is passed.
    const below = TIER_ORDER[TIER_ORDER.indexOf(assessment.tier) - 1];
    const cur = (await currentSkills(candidate._id)).find((s) => s.key === ((assessment.skills || [])[0] || {}).key);
    if (!cur || !tierPassed(cur.tiers && cur.tiers[below])) { const e = new Error('Pass the level below first'); e.code = 'locked'; throw e; }
  }
  if (await manualHold(candidate._id, assessment)) { const e = new Error('Needs staff approval'); e.code = 'manual'; throw e; }
  const wait = await nextAllowed(candidate._id, assessment);
  if (wait) { const e = new Error('Retake not yet allowed'); e.code = 'retake_wait'; e.until = wait; throw e; }
  const live = await SkillResult.findOne({
    candidateId: candidate._id, assessmentId, status: { $in: ['invited', 'started'] }, expiresAt: { $gt: new Date() }
  }).sort({ invitedAt: -1 });
  return live || coderbyte.inviteCandidate({ candidate, assessment });
}

const LEVEL_ORDER = ['Foundational', 'Intermediate', 'Advanced', 'Expert'];

// Rebuilds the candidate's searchable skill summary from published results and their visibility choices.
async function refreshSkillSummary(candidate) {
  const all = await currentSkills(candidate._id);
  const hidden = new Set(candidate.hiddenSkillKeys || []);
  candidate.skillSummary = all.filter((s) => !hidden.has(s.key) && SHOWABLE.has(s.level))
    .map((s) => ({ key: s.key, label: s.label, level: s.level, levelIndex: LEVEL_ORDER.indexOf(s.level) + 1, takenAt: s.takenAt }));
  candidate.titleSummary = (await titleResults(candidate._id)).filter((t) => t.showOnProfile)
    .map((t) => ({ assessmentId: t.assessmentId, name: t.name, score: t.score, right: t.right, total: t.total, takenAt: t.takenAt }));
  await candidate.save();
  return candidate.skillSummary;
}

async function setHidden(candidate, shownKeys) {
  const all = await currentSkills(candidate._id);
  const shown = new Set(shownKeys);
  candidate.hiddenSkillKeys = all.filter((s) => !shown.has(s.key)).map((s) => s.key);
  await refreshSkillSummary(candidate);
}

// ---- skill requests ------------------------------------------------------

const MAX_OPEN_REQUESTS = 10;

// Same text, different typing ("  Kubernetes ", "kubernetes") groups together.
function normalizeSkill(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9+#./ -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Throws .code: 'invalid' | 'exists' (a test already covers it) | 'limit'.
async function requestSkill(candidate, text) {
  const key = normalizeSkill(text);
  if (key.length < 2) { const e = new Error('Enter a skill name'); e.code = 'invalid'; throw e; }
  const asms = await SkillAssessment.find({ active: true });
  const covered = asms.some((a) => a.kind !== 'title' && (a.skills || []).some((s) => normalizeSkill(s.label) === key || s.key === key));
  if (covered) { const e = new Error('Already available'); e.code = 'exists'; throw e; }
  const mine = await SkillRequest.find({ candidateId: candidate._id });
  if (mine.some((r) => r.key === key)) return mine.find((r) => r.key === key);
  if (mine.filter((r) => ['requested', 'building'].includes(r.status)).length >= MAX_OPEN_REQUESTS) {
    const e = new Error('Too many open requests'); e.code = 'limit'; throw e;
  }
  const created = await SkillRequest.create({ candidateId: candidate._id, skill: String(text).trim().slice(0, 60), key });
  await require('./skillNotifications').newRequestAlert(created.skill || String(text).trim().slice(0, 60), key);
  return created;
}

// Called when a skill test goes live: marks matching requests ready and tells each candidate.
async function fulfillRequests(labels) {
  const keys = labels.map(normalizeSkill);
  const open = await SkillRequest.find({ key: { $in: keys }, status: { $in: ['requested', 'building'] } });
  for (const r of open) {
    r.status = 'ready'; r.readyAt = new Date(); await r.save();
    const c = await Candidate.findById(r.candidateId);
    if (c) await deliver(c, 'skill_ready', r.skill);
  }
  return open.length;
}

// Staff decision on a held attempt. Approve publishes it; reject keeps it unpublished for good.
async function decideReview(result, decision, note) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Invalid decision');
  result.reviewDecision = decision;
  result.reviewedAt = new Date();
  result.reviewNote = String(note || '').slice(0, 1000);
  await result.save();
  const c = await Candidate.findById(result.candidateId);
  const a = await SkillAssessment.findOne({ assessmentId: result.assessmentId });
  const name = (a && a.name) || 'skills';
  if (c) {
    await refreshSkillSummary(c);
    if (decision === 'approved') {
      await deliver(c, 'skill_approved', name);
    } else {
      const until = new Date(result.reviewedAt.getTime() + REJECT_COOLDOWN_DAYS * DAY).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      await deliver(c, 'skill_rejected', name, until);
    }
  }
  return result;
}

// Lets a candidate with repeated rejections try again.
async function clearRejections(candidateId, assessmentId) {
  const rows = await SkillResult.find({ candidateId, assessmentId, status: 'completed' });
  let n = 0;
  for (const r of rows) if (r.reviewDecision === 'rejected' && !r.rejectionCleared) { r.rejectionCleared = true; await r.save(); n++; }
  return n;
}

module.exports = { TIER_NAMES, buildLadders, LEVEL_ORDER, refreshSkillSummary, REJECT_COOLDOWN_DAYS, MAX_REJECTIONS, manualHold, decideReview, clearRejections, MAX_OPEN_REQUESTS, normalizeSkill, requestSkill, fulfillRequests, titleResults, setTitleVisibility, titleSummary, SHOWABLE, RETAKE_DAYS, STALE_DAYS, published, currentSkills, recruiterView, nextAllowed, startAttempt, setHidden };
