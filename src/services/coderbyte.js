// CoderByte skills-assessment integration.
//
//  invite  -> inviteCandidate(): no-PII link (public link + our own ID), no CoderByte email
//  joined  -> handleJoined():    webhook, marks the attempt started
//  done    -> handleCompleted(): webhook, pulls the full report and stores per-skill scores
//  repair  -> syncResult():      re-pull a report by hand if a webhook was missed
//
// Webhook payloads are minimal (no scores), so completion always follows up with
// a GET of the report. Auth for outgoing calls is the raw API key as a Bearer
// token (confirmed against the live API). Incoming webhooks carry an HS256 JWT
// signed with that same key.
const crypto = require('crypto');
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const { weightedSkill } = require('./skillLevels');

const BASE = 'https://coderbyte.com/api/organization';
const TIMEOUT_MS = 20000;
const INVITE_DAYS = () => Number(process.env.CODERBYTE_INVITE_DAYS) || 14;

function apiKey() {
  const key = process.env.CODERBYTE_API_KEY;
  if (!key) throw new Error('CODERBYTE_API_KEY is not set');
  return key;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`CoderByte ${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---- scores -------------------------------------------------------------

// Our skill score. Preferred: difficulty-weighted (easy 1, medium 2, hard 3) over this
// skill's questions, when every one of them has a mapped difficulty. Otherwise the
// average of the skill's CoderByte rating percentages (Linux + Unix report the same
// questions so they agree; averaging keeps it honest if a skill spans differing tags).
function computeSkills(assessment, ratings, answers = []) {
  const byName = new Map(ratings.map((r) => [r.name, r.score]));
  const difficultyById = new Map((assessment.questions || []).map((q) => [String(q.id), q.difficulty]));
  return (assessment.skills || []).map((s) => {
    const w = weightedSkill(answers, difficultyById, s.ratingKeys || []);
    if (w) return { key: s.key, label: s.label, score: w.score, weighted: true, level: w.level, tiers: w.tiers };
    const present = (s.ratingKeys || []).filter((k) => byName.has(k)).map((k) => byName.get(k));
    const score = present.length ? Math.round(present.reduce((a, b) => a + b, 0) / present.length) : null;
    // Difficulty not fully known for this skill's questions: no tier evidence, so no level yet.
    return { key: s.key, label: s.label, score, weighted: false, level: 'Provisional', tiers: null };
  });
}

// A candidate can complete the same assessment more than once; the API returns
// every submission. Use the latest completed one.
function pickReport(reports) {
  if (!Array.isArray(reports) || !reports.length) return null;
  const done = reports.filter((r) => String(r.status).toLowerCase() === 'completed');
  return (done.length ? done : reports)[(done.length ? done : reports).length - 1];
}

// CoderByte's flag reads e.g. "Not detected", "Likely", "Detected". Anything but a clear "not" that
// mentions likely/detected holds the attempt back.
function isFlagged(flag) {
  const f = String(flag || '').toLowerCase();
  if (!f || f.includes('not')) return false;
  return f.includes('likely') || f.includes('detect');
}

function applyReport(result, assessment, report) {
  const ratings = Object.entries(report.skill_ratings || {})
    .filter(([, v]) => Number.isFinite(Number(v)))
    .map(([name, v]) => ({ name, score: Number(v) }));
  result.ratings = ratings;
  // Outcome only: id, tags, right/wrong. Question text and the answer given are never kept.
  result.answers = (report.mc_details || []).map((q) => ({
    id: String(q.id), correct: !!q.correct, tags: (q.meta && q.meta.tags) || []
  }));
  result.skills = computeSkills(assessment, ratings, result.answers);
  result.overallScore = Number.isFinite(Number(report.final_score)) && Number(report.final_score) >= 0
    ? Number(report.final_score) : null;
  result.timeTakenMinutes = Number.isFinite(Number(report.time_taken)) ? Number(report.time_taken) : null;
  result.cheatingFlag = report.cheating_flag || null;
  const cd = report.cheating_details || {};
  result.aiUsage = !!cd.ai_usage;
  result.tabLeaving = Number(cd.tab_leaving) || 0;
  result.held = isFlagged(result.cheatingFlag) || result.aiUsage;
  result.reportReady = report.report_ready !== false;
  result.status = String(report.status).toLowerCase() === 'completed' ? 'completed' : result.status;
  if (result.status === 'completed' && !result.completedAt) result.completedAt = new Date();
  result.lastError = null;
}

async function fetchReport(ref, assessmentId) {
  const body = await api('GET', `/candidates/${encodeURIComponent(ref)}/${encodeURIComponent(assessmentId)}`);
  return pickReport(body && body.data && body.data.reports);
}

// Pull the report for an attempt and store its scores. Safe to run repeatedly.
async function syncResult(result) {
  const assessment = await SkillAssessment.findOne({ assessmentId: result.assessmentId });
  if (!assessment) throw new Error(`No catalog entry for assessment ${result.assessmentId}`);
  if (!result.coderbyteId) result.coderbyteId = coderbyteIdFor(result);
  const report = await fetchReport(result.coderbyteId, result.assessmentId);
  if (!report) throw new Error('CoderByte has no report for this attempt yet');
  applyReport(result, assessment, report);
  await result.save();
  return result;
}

// ---- identity -----------------------------------------------------------

// For no-PII invites CoderByte does not hand our ID back. It anonymizes it to an address of the
// form <first 10 hex chars of sha1(id)>@private.com, and that is what webhooks and the report
// API use. Verified against a live webhook: pc_97cdf7eb4a1640cc8e -> efd41f327e@private.com.
function deriveCoderbyteId(ref) {
  return `${crypto.createHash('sha1').update(String(ref)).digest('hex').slice(0, 10)}@private.com`;
}

// The id CoderByte knows an attempt by. Attempts made with a real email (the earliest tests)
// keep that email; no-PII attempts (pc_...) use the derived address.
function coderbyteIdFor(result) {
  if (result.coderbyteId) return result.coderbyteId;
  return String(result.inviteRef).startsWith('pc_') ? deriveCoderbyteId(result.inviteRef) : result.inviteRef;
}

async function findAttempt(email, assessmentId) {
  return (await SkillResult.findOne({ coderbyteId: email, assessmentId }))
    || (await SkillResult.findOne({ inviteRef: email, assessmentId }));
}

// ---- invites ------------------------------------------------------------

// No-PII invite, per CoderByte's documented method: the assessment's public link with
// `&id=<our ID>&no_pii=true` appended. No API call and no email; CoderByte never sees
// the candidate's details, only our opaque ID, which comes back to us in webhooks and
// reports. (The API invite endpoint takes emails only: given our ID it returned an
// empty candidate list.) The link itself does not expire, so our own `expiresAt` is
// enforced by whatever shows the link, and `allow_redo: false` blocks reuse.
function inviteLink(assessment, inviteRef) {
  const base = assessment.publicUrl;
  return `${base}${base.includes('?') ? '&' : '?'}id=${encodeURIComponent(inviteRef)}&no_pii=true`;
}

async function inviteCandidate({ candidate, assessment }) {
  const inviteRef = `pc_${crypto.randomBytes(9).toString('hex')}`;
  const expiresAt = new Date(Date.now() + INVITE_DAYS() * 86400000);
  return SkillResult.create({
    candidateId: candidate._id,
    assessmentId: assessment.assessmentId,
    inviteRef,
    coderbyteId: deriveCoderbyteId(inviteRef),
    status: 'invited',
    inviteUrl: inviteLink(assessment, inviteRef),
    invitedAt: new Date(),
    expiresAt
  });
}

// ---- webhooks -----------------------------------------------------------

// Bearer JWT, HS256, signed with our API key. `iss` should be the org id; we
// check it only if CODERBYTE_ORG_ID is set (it isn't shown in their dashboard).
function verifyWebhookAuth(header) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m) return { ok: false, reason: 'missing bearer token' };
  const parts = m[1].split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return { ok: false, reason: 'unexpected alg' };
    const expected = crypto.createHmac('sha256', apiKey()).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return { ok: false, reason: 'bad signature' };
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) return { ok: false, reason: 'expired token' };
    if (process.env.CODERBYTE_ORG_ID && payload.iss && payload.iss !== process.env.CODERBYTE_ORG_ID) {
      return { ok: false, reason: 'wrong issuer' };
    }
    return { ok: true, iss: payload.iss };
  } catch {
    return { ok: false, reason: 'unreadable token' };
  }
}

function parseWebhook(req, res) {
  const auth = verifyWebhookAuth(req.get('authorization'));
  if (!auth.ok) {
    console.warn('[coderbyte] webhook rejected:', auth.reason);
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    const payload = JSON.parse(raw);
    if (!global.__cbIssLogged && auth.iss) {
      global.__cbIssLogged = true;
      console.log('[coderbyte] webhook issuer (organization id):', auth.iss);
    }
    return payload;
  } catch {
    res.status(400).json({ error: 'bad json' });
    return null;
  }
}

async function handleJoined(req, res) {
  const p = parseWebhook(req, res);
  if (!p) return;
  try {
    const result = await findAttempt(p.email, p.assessment_id);
    if (result && result.status === 'invited') {
      result.status = 'started';
      result.startedAt = new Date();
      await result.save();
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[coderbyte] joined failed:', e.message);
    res.status(500).json({ error: 'failed' });
  }
}

async function handleCompleted(req, res) {
  const p = parseWebhook(req, res);
  if (!p) return;
  try {
    const result = await findAttempt(p.email, p.assessment_id);
    if (!result) {
      // Not one of ours (e.g. someone opened the public link directly). Acknowledge so it isn't retried.
      console.warn('[coderbyte] completed webhook for unknown attempt, ignoring. email field:', String(p.email).slice(0, 40));
      return res.json({ ok: true, ignored: true });
    }
    result.timeExpired = !!p.time_expired;
    await syncResult(result);
    res.json({ ok: true });
  } catch (e) {
    console.error('[coderbyte] completed failed:', e.message);
    res.status(500).json({ error: 'failed' }); // non-2xx so CoderByte may retry
  }
}

module.exports = {
  api, inviteCandidate, inviteLink, deriveCoderbyteId, coderbyteIdFor, syncResult, fetchReport, pickReport, applyReport, isFlagged, computeSkills,
  verifyWebhookAuth, handleJoined, handleCompleted
};
