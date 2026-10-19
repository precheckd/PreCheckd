// CoderByte skills-assessment integration.
//
//  invite  -> inviteCandidate(): private link, no CoderByte email, our own ID in place of an email
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
const { levelFor, weightedSkill } = require('./skillLevels');

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
    return { key: s.key, label: s.label, score, weighted: false, level: levelFor(score), tiers: null };
  });
}

// A candidate can complete the same assessment more than once; the API returns
// every submission. Use the latest completed one.
function pickReport(reports) {
  if (!Array.isArray(reports) || !reports.length) return null;
  const done = reports.filter((r) => String(r.status).toLowerCase() === 'completed');
  return (done.length ? done : reports)[(done.length ? done : reports).length - 1];
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
  const report = await fetchReport(result.inviteRef, result.assessmentId);
  if (!report) throw new Error('CoderByte has no report for this attempt yet');
  applyReport(result, assessment, report);
  await result.save();
  return result;
}

// ---- invites ------------------------------------------------------------

// The 200 response shape isn't documented, so find the private link wherever it is.
function extractInviteUrl(body, ref) {
  const urls = [];
  (function walk(v, key) {
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v)) urls.push({ url: v, key });
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
  })(body);
  if (!urls.length) return null;
  const hit = urls.find((u) => u.key === ref || u.url.includes(ref)) || urls[0];
  return hit.url;
}

async function inviteCandidate({ candidate, assessment, debug = false }) {
  const inviteRef = `pc_${crypto.randomBytes(9).toString('hex')}`;
  const expiresAt = new Date(Date.now() + INVITE_DAYS() * 86400000);
  const result = await SkillResult.create({
    candidateId: candidate._id,
    assessmentId: assessment.assessmentId,
    inviteRef,
    status: 'invited',
    invitedAt: new Date(),
    expiresAt
  });
  try {
    const body = await api('POST', '/candidates/invite', {
      assessment_url: assessment.publicUrl,
      candidates: [inviteRef],
      skip_send: true,
      expire_date: expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z')
    });
    if (debug) console.log('invite response:', JSON.stringify(body, null, 2));
    const url = extractInviteUrl(body, inviteRef);
    if (!url) throw new Error('CoderByte returned no invite link');
    result.inviteUrl = url;
    await result.save();
  } catch (e) {
    result.status = 'failed';
    result.lastError = String(e.message).slice(0, 300);
    await result.save();
    throw e;
  }
  return result;
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
    const result = await SkillResult.findOne({ inviteRef: p.email, assessmentId: p.assessment_id });
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
    const result = await SkillResult.findOne({ inviteRef: p.email, assessmentId: p.assessment_id });
    if (!result) {
      // Not one of ours (e.g. someone opened the public link directly). Acknowledge so it isn't retried.
      console.warn('[coderbyte] completed webhook for unknown attempt, ignoring');
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
  api, inviteCandidate, syncResult, fetchReport, pickReport, applyReport, computeSkills,
  extractInviteUrl, verifyWebhookAuth, handleJoined, handleCompleted
};
