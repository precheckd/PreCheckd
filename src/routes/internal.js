const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const FraudReport = require('../models/FraudReport');
const Message = require('../models/Message');
const SkillRequest = require('../models/SkillRequest');
const SkillResult = require('../models/SkillResult');
const SkillAssessment = require('../models/SkillAssessment');
const skillsService = require('../services/skills');
const { PUBLIC_EMAIL_DOMAINS, EMAIL_REPORT_THRESHOLD, DOMAIN_REPORT_THRESHOLD } = require('../config/fraudConfig');
const { sendAdminLoginAlertEmail, sendAdminLoginCodeEmail } = require('../services/emailService');
const { getDailyPageViews } = require('../services/googleAnalyticsService');

const SIGNUP_CHART_DAYS = 30;

// Builds a full, zero-filled array of the last `days` calendar days (today
// inclusive) in YYYY-MM-DD order, so a day with zero signups still shows a
// bar/point instead of silently skipping — a gap in the x-axis reads as
// "we have no data for that day," which would be wrong.
function buildDateRange(days) {
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function countsByDate(aggregateResult, dateRange) {
  const lookup = {};
  aggregateResult.forEach((row) => { lookup[row._id] = row.count; });
  return dateRange.map((date) => lookup[date] || 0);
}

const INTERNAL_ADMIN_SECRET = process.env.INTERNAL_ADMIN_SECRET;

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// --- CSRF protection (synchronizer token pattern) ---
// Every internal form (suspend/unsuspend, fraud-status changes, dispute
// replies, verification toggles, even the login forms themselves) is a
// plain POST with no other protection against cross-site forgery — a
// logged-in admin who merely loads a malicious page could otherwise have
// one of these POSTs fired on their behalf. A per-session random token is
// generated on first visit, rendered into every form as a hidden field,
// and checked against the session on every state-changing request. Kept
// in the session (already present via express-session) rather than a
// second double-submit cookie, so there's no new dependency and no cookie
// plumbing to get right.
function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyCsrfToken(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  const submitted = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!tokensMatch(req.session.csrfToken, submitted)) {
    return res.status(403).send('Your session expired or this form was submitted from somewhere unexpected. Please go back, reload the page, and try again.');
  }
  next();
}

router.use(ensureCsrfToken, verifyCsrfToken);

// --- Brute-force protection on the shared admin secret ---
// This is a single shared password, not per-staff accounts, so there's no
// "lock this one account" option — an IP-based cap is the whole defense,
// same in-memory pattern already used for the public fraud-report endpoint.
// A single Render instance makes this fine; worst case on a restart is the
// limit resets early, not that it silently stops limiting anything.
const LOGIN_RATE_LIMIT_MAX = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const loginAttemptLog = new Map(); // ip -> array of failed-attempt timestamps (ms)

// At most one "someone's hammering the admin login" alert per IP per
// window, even though the IP stays rate-limited well past that point —
// one email makes the point; a string of them doesn't add information.
const ALERT_DEBOUNCE_MS = 60 * 60 * 1000;
const lastAlertedAt = new Map(); // ip -> timestamp (ms)

function isOverLoginRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - LOGIN_RATE_LIMIT_WINDOW_MS;
  const timestamps = (loginAttemptLog.get(ip) || []).filter((t) => t > windowStart);
  return timestamps.length >= LOGIN_RATE_LIMIT_MAX;
}

function recordFailedLoginAttempt(ip) {
  const now = Date.now();
  const windowStart = now - LOGIN_RATE_LIMIT_WINDOW_MS;
  const timestamps = (loginAttemptLog.get(ip) || []).filter((t) => t > windowStart);
  timestamps.push(now);
  loginAttemptLog.set(ip, timestamps);

  if (timestamps.length >= LOGIN_RATE_LIMIT_MAX) {
    const alertedAt = lastAlertedAt.get(ip);
    if (!alertedAt || now - alertedAt > ALERT_DEBOUNCE_MS) {
      lastAlertedAt.set(ip, now);
      sendAdminLoginAlertEmail(ip, timestamps.length).catch((error) => {
        console.error('Failed to send admin login alert email:', error);
      });
    }
  }
}

// Real staff session, once fully logged in (secret + emailed code), is capped
// much shorter than the normal 30-day cookie everyone else gets — this is
// the one login on the site that's worth re-proving more often.
const ADMIN_SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours

function requireInternalAuth(req, res, next) {
  if (req.session.isInternalAdmin && req.session.adminSessionExpires > Date.now()) {
    return next();
  }
  req.session.isInternalAdmin = false;
  req.session.adminSessionExpires = null;
  res.redirect('/login');
}

// Step 1 — shared secret
router.get('/login', (req, res) => {
  res.render('internal-login', { error: null, step: 'secret' });
});

router.post('/login', (req, res) => {
  if (isOverLoginRateLimit(req.ip)) {
    return res.render('internal-login', { error: 'Too many attempts from this network. Please try again later.', step: 'secret' });
  }

  const { secret } = req.body;

  if (!INTERNAL_ADMIN_SECRET) {
    return res.render('internal-login', { error: 'INTERNAL_ADMIN_SECRET is not configured on the server.', step: 'secret' });
  }

  if (secret !== INTERNAL_ADMIN_SECRET) {
    recordFailedLoginAttempt(req.ip);
    return res.render('internal-login', { error: 'Incorrect password.', step: 'secret' });
  }

  const code = generateSixDigitCode();
  req.session.adminLoginCode = code;
  req.session.adminLoginCodeExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  sendAdminLoginCodeEmail(code).catch((error) => {
    console.error('Failed to send admin login code email:', error);
  });

  res.render('internal-login', { error: null, step: 'code' });
});

// Step 2 — emailed code
router.post('/login/verify-code', (req, res) => {
  if (isOverLoginRateLimit(req.ip)) {
    return res.render('internal-login', { error: 'Too many attempts from this network. Please try again later.', step: 'secret' });
  }

  const { code } = req.body;

  if (!req.session.adminLoginCode) {
    return res.render('internal-login', { error: 'Please log in again.', step: 'secret' });
  }
  if (Date.now() > req.session.adminLoginCodeExpires) {
    req.session.adminLoginCode = null;
    return res.render('internal-login', { error: 'That code expired. Please log in again.', step: 'secret' });
  }
  if (!code || code.trim() !== req.session.adminLoginCode) {
    recordFailedLoginAttempt(req.ip);
    return res.render('internal-login', { error: 'Incorrect code.', step: 'code' });
  }

  req.session.adminLoginCode = null;
  req.session.adminLoginCodeExpires = null;
  req.session.isInternalAdmin = true;
  req.session.adminSessionExpires = Date.now() + ADMIN_SESSION_MS;

  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.isInternalAdmin = false;
  req.session.adminSessionExpires = null;
  res.redirect('/login');
});

router.use(requireInternalAuth);

// Landing dashboard — links out to each internal tool
router.get('/', async (req, res) => {
  try {
    const dateRange = buildDateRange(SIGNUP_CHART_DAYS);
    const since = new Date(Date.now() - SIGNUP_CHART_DAYS * 24 * 60 * 60 * 1000);
    const dailyGroupStage = {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    };

    const [
      candidateCount,
      flaggedCount,
      disputeThreads,
      recruiterSignupsByDay,
      candidateSignupsByDay,
      pageViewsByDay,
    ] = await Promise.all([
      Candidate.countDocuments({
        $or: [
          { 'workHistory.0': { $exists: true } },
          { 'educationHistory.0': { $exists: true } },
          { 'certifications.0': { $exists: true } }
        ]
      }),
      FraudReport.aggregate([
        {
          $group: {
            _id: '$reportedEmail',
            reporters: { $addToSet: '$reporterEmail' }
          }
        },
        { $project: { distinctReporters: { $size: '$reporters' } } },
        { $match: { distinctReporters: { $gte: EMAIL_REPORT_THRESHOLD } } },
        { $count: 'total' }
      ]),
      Message.aggregate([
        { $match: { fraudReportId: { $ne: null } } },
        { $sort: { sentAt: -1 } },
        { $group: { _id: '$fraudReportId', latestSenderType: { $first: '$senderType' } } },
        { $match: { latestSenderType: 'recruiter' } },
        { $count: 'total' }
      ]),
      Recruiter.aggregate([
        { $match: { createdAt: { $gte: since } } },
        dailyGroupStage,
      ]),
      Candidate.aggregate([
        { $match: { createdAt: { $gte: since } } },
        dailyGroupStage,
      ]),
      // Returns null (not an empty series) until GA4 is actually wired up —
      // the dashboard/view treats null as "not connected yet" vs. a real
      // all-zero traffic day, so it never looks like the site has no visitors.
      getDailyPageViews(SIGNUP_CHART_DAYS).catch((error) => {
        console.error('Failed to load Google Analytics page views:', error);
        return null;
      }),
    ]);

    const vcDigest = await require('../services/verificationCases').digestSummary();
    const verificationCount = vcDigest.calls + vcDigest.replies + vcDigest.contacts;
    const skillRequestCount = (await SkillRequest.distinct('key', { status: { $in: ['requested', 'building'] } })).length;

    const integrityCount = await SkillResult.countDocuments({ status: 'completed', held: true, reviewDecision: null });

    res.render('internal-dashboard', {
      integrityCount,
      skillRequestCount,
      verificationCount,
      verificationOpen: vcDigest.open,
      candidateCount,
      flaggedCount: flaggedCount[0]?.total || 0,
      disputeAttentionCount: disputeThreads[0]?.total || 0,
      signupChart: {
        labels: dateRange,
        recruiters: countsByDate(recruiterSignupsByDay, dateRange),
        candidates: countsByDate(candidateSignupsByDay, dateRange),
      },
      trafficChart: pageViewsByDay ? { labels: dateRange, views: countsByDate(pageViewsByDay, dateRange) } : null,
    });
  } catch (error) {
    console.error('Error loading internal dashboard:', error);
    res.status(500).send('Server error');
  }
});

// Held skill-test attempts (CoderByte flagged cheating or AI use), oldest first.
router.get('/integrity-review', async (req, res) => {
  try {
    const held = await SkillResult.find({ status: 'completed', held: true, reviewDecision: null }).sort({ completedAt: 1 });
    const [cands, asms] = await Promise.all([
      Candidate.find({ _id: { $in: held.map((r) => r.candidateId) } }),
      SkillAssessment.find({ assessmentId: { $in: held.map((r) => r.assessmentId) } })
    ]);
    const cById = new Map(cands.map((c) => [String(c._id), c]));
    const aById = new Map(asms.map((a) => [a.assessmentId, a]));
    res.render('internal-integrity-list', {
      rows: held.map((r) => ({ r, candidate: cById.get(String(r.candidateId)), assessment: aById.get(r.assessmentId) }))
    });
  } catch (error) {
    console.error('Error loading integrity review:', error);
    res.status(500).send('Server error');
  }
});

router.get('/integrity-review/:id', async (req, res) => {
  try {
    const result = await SkillResult.findById(req.params.id);
    if (!result) return res.status(404).send('Attempt not found.');
    const [candidate, assessment, history] = await Promise.all([
      Candidate.findById(result.candidateId),
      SkillAssessment.findOne({ assessmentId: result.assessmentId }),
      SkillResult.find({ candidateId: result.candidateId, status: 'completed' }).sort({ completedAt: -1 })
    ]);
    const asms = await SkillAssessment.find({ assessmentId: { $in: history.map((h) => h.assessmentId) } });
    const nameOf = new Map(asms.map((a) => [a.assessmentId, a.name]));
    res.render('internal-integrity-detail', {
      result, candidate, assessment,
      summary: assessment && assessment.kind === 'title' ? skillsService.titleSummary(result, assessment) : null,
      history: history.map((h) => ({ h, name: nameOf.get(h.assessmentId) || h.assessmentId })),
      rejections: history.filter((h) => h.reviewDecision === 'rejected' && !h.rejectionCleared).length,
      maxRejections: skillsService.MAX_REJECTIONS
    });
  } catch (error) {
    console.error('Error loading integrity detail:', error);
    res.status(500).send('Server error');
  }
});

router.post('/integrity-review/:id/decision', async (req, res) => {
  try {
    const result = await SkillResult.findById(req.params.id);
    if (!result) return res.status(404).send('Attempt not found.');
    const decision = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
    if (!decision) return res.status(400).send('Invalid decision.');
    await skillsService.decideReview(result, decision, req.body.note);
    res.redirect('/integrity-review');
  } catch (error) {
    console.error('Error saving integrity decision:', error);
    res.status(500).send('Server error');
  }
});

router.post('/integrity-review/:id/clear', async (req, res) => {
  try {
    const result = await SkillResult.findById(req.params.id);
    if (!result) return res.status(404).send('Attempt not found.');
    await skillsService.clearRejections(result.candidateId, result.assessmentId);
    res.redirect(`/integrity-review/${result._id}`);
  } catch (error) {
    console.error('Error clearing rejections:', error);
    res.status(500).send('Server error');
  }
});

// Skills candidates have asked to be tested on, most-requested first. Tests are built by hand in
// CoderByte, so this is the build queue.
router.get('/skill-requests', async (req, res) => {
  try {
    const rows = await SkillRequest.aggregate([
      { $group: { _id: '$key', skill: { $first: '$skill' }, count: { $sum: 1 }, latest: { $max: '$createdAt' },
          statuses: { $addToSet: '$status' },
          oldestOpen: { $min: { $cond: [{ $in: ['$status', ['requested', 'building']] }, '$createdAt', null] } } } },
      { $sort: { count: -1, latest: -1 } }
    ]);
    const label = (st) => (st.includes('ready') && st.length === 1 ? 'ready' : st.includes('building') ? 'building' : st.includes('declined') && st.length === 1 ? 'declined' : 'requested');
    const { businessHoursSince, slaFlag } = require('../utils/businessTime');
    const shaped = rows.map((r) => {
      const waiting = r.oldestOpen ? businessHoursSince(r.oldestOpen) : null;
      return { ...r, status: label(r.statuses), waiting, flag: waiting === null ? null : slaFlag(waiting) };
    });
    // Waiting requests first, oldest at the top; finished ones sink to the bottom.
    shaped.sort((a, b) => (a.waiting === null) - (b.waiting === null) || (b.waiting || 0) - (a.waiting || 0) || b.count - a.count);
    res.render('internal-skill-requests', { rows: shaped });
  } catch (error) {
    console.error('Error loading skill requests:', error);
    res.status(500).send('Server error');
  }
});

// Job-title test credits: recruiters get a monthly allowance (TEST_CREDITS_PER_MONTH); staff can top one up.
router.get('/test-credits', async (req, res) => {
  try {
    const TestRequest = require('../models/TestRequest');
    const Recruiter = require('../models/Recruiter');
    const testRequests = require('../services/testRequests');
    await testRequests.expireOverdue();
    const recent = await TestRequest.find({}).sort({ sentAt: -1 }).limit(40);
    const rec = new Map((await Recruiter.find({ _id: { $in: recent.map((r) => r.recruiterId) } })).map((r) => [String(r._id), r]));
    const cand = new Map((await require('../models/Candidate').find({ _id: { $in: recent.map((r) => r.candidateId) } })).map((c) => [String(c._id), c]));
    res.render('internal-test-credits', {
      perMonth: testRequests.monthlyCredits(),
      notice: req.query.notice || null,
      recent: recent.map((r) => ({ status: r.status, assessmentId: r.assessmentId, sentAt: r.sentAt,
        recruiter: rec.get(String(r.recruiterId)) ? rec.get(String(r.recruiterId)).email : '?',
        candidate: cand.get(String(r.candidateId)) ? `${cand.get(String(r.candidateId)).firstName} ${cand.get(String(r.candidateId)).lastName || ''}`.trim() : '?' }))
    });
  } catch (error) {
    console.error('Error loading test credits:', error);
    res.status(500).send('Server error');
  }
});

router.post('/test-credits/grant', async (req, res) => {
  try {
    const Recruiter = require('../models/Recruiter');
    const recruiter = await Recruiter.findOne({ email: String(req.body.email || '').trim().toLowerCase() });
    if (!recruiter) return res.redirect('/test-credits?notice=norecruiter');
    await require('../services/testRequests').grantCredits(recruiter, req.body.amount);
    res.redirect('/test-credits?notice=granted');
  } catch (error) {
    if (error.code === 'invalid') return res.redirect('/test-credits?notice=invalid');
    console.error('Error granting test credits:', error);
    res.status(500).send('Server error');
  }
});

// ---- Verification cases (employment and education) ------------------------------------------------------
// The routine and its wording live in services/verificationCases.js. Staff start a case from a candidate's
// verify screen; this queue shows what needs doing today.
router.post('/verify/:candidateId/case', async (req, res) => {
  try {
    const vc = require('../services/verificationCases');
    const candidate = await Candidate.findById(req.params.candidateId);
    if (!candidate) return res.status(404).send('Candidate not found.');
    const created = await vc.start(candidate, req.body.category, Number(req.body.index), {
      name: req.body.contactName, email: req.body.contactEmail, phone: req.body.contactPhone
    });
    res.redirect(`/verification-cases/${created._id}`);
  } catch (error) {
    if (['no_entry', 'already_verified', 'exists', 'bad_email'].includes(error.code)) {
      return res.redirect(`/verify/${req.params.candidateId}?case=${error.code}`);
    }
    console.error('Error starting verification case:', error);
    res.status(500).send('Server error');
  }
});

router.get('/verification-cases', async (req, res) => {
  try {
    const vc = require('../services/verificationCases');
    const VerificationCase = require('../models/VerificationCase');
    const cases = await VerificationCase.find({ status: { $in: ['outreach', 'with_candidate'] } });
    const cands = new Map((await Candidate.find({ _id: { $in: cases.map((c) => c.candidateId) } })).map((c) => [String(c._id), c]));
    const rank = { reply: 0, call: 1, contact: 2, wait: 3 };
    const rows = cases.map((c) => {
      const cand = cands.get(String(c.candidateId));
      return { id: c._id, candidate: cand ? `${cand.firstName} ${cand.lastName || ''}`.trim() : '?', kind: c.category === 'workHistory' ? 'Employment' : 'Education',
        subject: c.subject, detail: c.detail, day: vc.dayOf(c), status: c.status, action: vc.nextAction(c) };
    }).sort((a, b) => rank[a.action.kind] - rank[b.action.kind] || b.day - a.day);
    const closed = await VerificationCase.find({ status: { $in: ['verified', 'unable'] } }).sort({ closedAt: -1 }).limit(15);
    res.render('internal-verification-cases', {
      rows, openDay: vc.OPEN_DAY,
      closed: closed.map((c) => ({ id: c._id, subject: c.subject, status: c.status, closedAt: c.closedAt }))
    });
  } catch (error) {
    console.error('Error loading verification cases:', error);
    res.status(500).send('Server error');
  }
});

router.get('/verification-cases/:id', async (req, res) => {
  try {
    const vc = require('../services/verificationCases');
    const VerificationCase = require('../models/VerificationCase');
    const c = await VerificationCase.findById(req.params.id).catch(() => null);
    if (!c) return res.status(404).send('Case not found.');
    const candidate = await Candidate.findById(c.candidateId);
    const messages = await Message.find({ verificationCaseId: c._id }).sort({ sentAt: 1 });
    await Message.updateMany({ verificationCaseId: c._id, recipientType: 'system', readAt: null }, { readAt: new Date() });
    res.render('internal-verification-case', {
      c, candidate, messages, day: vc.dayOf(c), action: vc.nextAction(c), openDay: vc.OPEN_DAY,
      outcomes: vc.OUTCOMES, notice: req.query.notice || null,
      asks: { open: vc.TEXT.open(c) }
    });
  } catch (error) {
    console.error('Error loading verification case:', error);
    res.status(500).send('Server error');
  }
});

router.post('/verification-cases/:id/:action', async (req, res) => {
  try {
    const vc = require('../services/verificationCases');
    const VerificationCase = require('../models/VerificationCase');
    const c = await VerificationCase.findById(req.params.id).catch(() => null);
    if (!c) return res.status(404).send('Case not found.');
    const back = (n) => res.redirect(`/verification-cases/${c._id}${n ? `?notice=${n}` : ''}`);
    try {
      switch (req.params.action) {
        case 'contact': await vc.saveContact(c, { name: req.body.contactName, email: req.body.contactEmail, phone: req.body.contactPhone }); return back('saved');
        case 'call': await vc.logCall(c, req.body.outcome); return back('logged');
        case 'note': await vc.note(c, req.body.note); return back('noted');
        case 'open': await vc.openNow(c); return back('opened');
        case 'reply': await vc.staffReply(c, req.body.body); return back('sent');
        case 'verified': case 'unable': await vc.resolve(c, req.params.action); return back('closed');
        default: return res.status(400).send('Unknown action.');
      }
    } catch (e) {
      if (['bad_email', 'invalid', 'empty', 'closed'].includes(e.code)) return back(e.code);
      throw e;
    }
  } catch (error) {
    console.error('Error updating verification case:', error);
    res.status(500).send('Server error');
  }
});

// Mark every open request for a skill as being built, declined, or back to requested. "Ready" is
// set automatically when the test is registered (scripts/coderbyte-seed-catalog.js).
router.post('/skill-requests/status', async (req, res) => {
  try {
    const { key, status } = req.body;
    if (!['requested', 'building', 'declined'].includes(status)) return res.status(400).send('Invalid status.');
    await SkillRequest.updateMany({ key, status: { $ne: 'ready' } }, { $set: { status } });
    res.redirect('/skill-requests');
  } catch (error) {
    console.error('Error updating skill requests:', error);
    res.status(500).send('Server error');
  }
});

// List all candidates who have at least one work/education/certification entry
router.get('/verify', async (req, res) => {
  try {
    const candidates = await Candidate.find({
      $or: [
        { 'workHistory.0': { $exists: true } },
        { 'educationHistory.0': { $exists: true } },
        { 'certifications.0': { $exists: true } }
      ]
    }).sort({ createdAt: -1 });

    res.render('internal-verify-list', { candidates });
  } catch (error) {
    console.error('Error loading internal verify list:', error);
    res.status(500).send('Server error');
  }
});

// Detail view for one candidate — shows every entry with a toggle
router.get('/verify/:candidateId', async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.candidateId);
    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }
    res.render('internal-verify-detail', { candidate, caseNotice: req.query.case || null });
  } catch (error) {
    console.error('Error loading candidate for internal verify:', error);
    res.status(500).send('Server error');
  }
});

// Toggle a single entry's verified status
router.post('/verify/:candidateId/toggle', async (req, res) => {
  try {
    const { category, index } = req.body;
    const candidate = await Candidate.findById(req.params.candidateId);

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    const validCategories = ['workHistory', 'educationHistory', 'certifications'];
    if (!validCategories.includes(category)) {
      return res.status(400).send('Invalid category.');
    }

    const entry = candidate[category][index];
    if (!entry) {
      return res.status(400).send('Entry not found at that index.');
    }

    entry.verified = !entry.verified;
    entry.verifiedAt = entry.verified ? new Date() : null;

    candidate.markModified(category);
    await candidate.save();

    res.redirect(`/verify/${candidate._id}`);
  } catch (error) {
    console.error('Error toggling verification status:', error);
    res.status(500).send('Server error');
  }
});

// Fraud dashboard — lists EVERY reported email/domain, not just ones that
// crossed the threshold. A single, isolated report can be the first sign of
// something that blows up later, so nothing gets hidden from staff; the
// threshold is only used (client-side, via `flagged` below) to highlight
// rows worth looking at first.
router.get('/fraud', async (req, res) => {
  try {
    const flaggedEmails = await FraudReport.aggregate([
      {
        $group: {
          _id: '$reportedEmail',
          reporters: { $addToSet: '$reporterEmail' },
          count: { $sum: 1 },
          latest: { $max: '$createdAt' },
          matchedRecruiterId: { $first: '$matchedRecruiterId' },
        }
      },
      {
        $project: {
          reportedEmail: '$_id',
          distinctReporters: { $size: '$reporters' },
          count: 1,
          latest: 1,
          matchedRecruiterId: 1,
        }
      },
      { $sort: { distinctReporters: -1, latest: -1 } },
    ]);
    flaggedEmails.forEach((item) => {
      item.flagged = item.distinctReporters >= EMAIL_REPORT_THRESHOLD;
    });

    const flaggedDomains = await FraudReport.aggregate([
      { $match: { reportedDomain: { $nin: PUBLIC_EMAIL_DOMAINS, $ne: '' } } },
      {
        $group: {
          _id: '$reportedDomain',
          reporters: { $addToSet: '$reporterEmail' },
          count: { $sum: 1 },
          latest: { $max: '$createdAt' },
        }
      },
      {
        $project: {
          reportedDomain: '$_id',
          distinctReporters: { $size: '$reporters' },
          count: 1,
          latest: 1,
        }
      },
      { $sort: { distinctReporters: -1, latest: -1 } },
    ]);
    flaggedDomains.forEach((item) => {
      item.flagged = item.distinctReporters >= DOMAIN_REPORT_THRESHOLD;
    });

    res.render('internal-fraud-list', {
      flaggedEmails,
      flaggedDomains,
      emailThreshold: EMAIL_REPORT_THRESHOLD,
      domainThreshold: DOMAIN_REPORT_THRESHOLD,
    });
  } catch (error) {
    console.error('Error loading fraud dashboard:', error);
    res.status(500).send('Server error');
  }
});

// Detail view — every individual report against one exact email address
router.get('/fraud/email/:email', async (req, res) => {
  try {
    const reportedEmail = req.params.email.toLowerCase();
    const reports = await FraudReport.find({ reportedEmail })
      .sort({ createdAt: -1 })
      .populate('matchedRecruiterId', 'firstName lastName email slug isIdentityVerified isSuspended');

    // Only an exact-email match actually points at the account behind
    // *this* reported email — a domain match points at a different person
    // at the same company, so suspending from here would hit the wrong
    // account. Find the first report (if any) that's a real exact match.
    const matchedAccount = reports.find((r) => r.matchType === 'email' && r.matchedRecruiterId)?.matchedRecruiterId || null;

    res.render('internal-fraud-detail', {
      targetLabel: reportedEmail,
      targetType: 'email',
      reports,
      matchedAccount,
    });
  } catch (error) {
    console.error('Error loading fraud detail (email):', error);
    res.status(500).send('Server error');
  }
});

// Detail view — every individual report against one domain
router.get('/fraud/domain/:domain', async (req, res) => {
  try {
    const reportedDomain = req.params.domain.toLowerCase();
    const reports = await FraudReport.find({ reportedDomain })
      .sort({ createdAt: -1 })
      .populate('matchedRecruiterId', 'firstName lastName email slug isIdentityVerified isSuspended');

    res.render('internal-fraud-detail', {
      targetLabel: reportedDomain,
      targetType: 'domain',
      reports,
      matchedAccount: null,
    });
  } catch (error) {
    console.error('Error loading fraud detail (domain):', error);
    res.status(500).send('Server error');
  }
});

// Suspend / unsuspend a recruiter account — manual, staff-only, reversible.
// Never automated and never visible to anyone but the recruiter themselves
// (and only indirectly, as a login/profile dead-end) — nothing here is ever
// surfaced publicly as "this account was suspended for fraud."
router.post('/recruiter/:id/suspend', async (req, res) => {
  try {
    const { redirectTo } = req.body;
    await Recruiter.findByIdAndUpdate(req.params.id, {
      isSuspended: true,
      suspendedAt: new Date(),
    });
    res.redirect(redirectTo || '/fraud');
  } catch (error) {
    console.error('Error suspending recruiter account:', error);
    res.status(500).send('Server error');
  }
});

router.post('/recruiter/:id/unsuspend', async (req, res) => {
  try {
    const { redirectTo } = req.body;
    await Recruiter.findByIdAndUpdate(req.params.id, {
      isSuspended: false,
      suspendedAt: null,
    });
    res.redirect(redirectTo || '/fraud');
  } catch (error) {
    console.error('Error unsuspending recruiter account:', error);
    res.status(500).send('Server error');
  }
});

// Dispute inbox — every fraud-dispute thread (the in-platform conversation
// tied to a report via fraudReportId), meant to be checked like an inbox
// rather than relying on an email ping per reply. "Needs attention" means
// the most recent message in the thread came from the recruiter — i.e.
// it's staff's turn to respond. Same definition the landing-page count uses.
router.get('/disputes', async (req, res) => {
  try {
    const threads = await Message.aggregate([
      { $match: { fraudReportId: { $ne: null } } },
      { $sort: { sentAt: -1 } },
      {
        $group: {
          _id: '$fraudReportId',
          latestBody: { $first: '$body' },
          latestSentAt: { $first: '$sentAt' },
          latestSenderType: { $first: '$senderType' },
        }
      },
      { $sort: { latestSentAt: -1 } },
    ]);

    const reports = await FraudReport.find({ _id: { $in: threads.map((t) => t._id) } })
      .populate('matchedRecruiterId', 'firstName lastName email');

    const reportsById = {};
    reports.forEach((r) => { reportsById[r._id.toString()] = r; });

    const threadsForView = threads.map((t) => {
      const report = reportsById[t._id.toString()];
      const recruiter = report?.matchedRecruiterId;
      return {
        fraudReportId: t._id,
        latestBody: t.latestBody,
        latestSentAt: t.latestSentAt,
        needsAttention: t.latestSenderType === 'recruiter',
        recruiterName: recruiter ? `${recruiter.firstName} ${recruiter.lastName || ''}`.trim() : 'Unknown',
        reportedEmail: report ? report.reportedEmail : 'Unknown',
      };
    });

    res.render('internal-disputes-list', { threads: threadsForView });
  } catch (error) {
    console.error('Error loading disputes list:', error);
    res.status(500).send('Server error');
  }
});

// Dispute thread detail — full back-and-forth, plus a reply box so staff
// can respond without leaving the dashboard. Opening it marks the
// recruiter's messages read, same as a normal inbox.
router.get('/disputes/:fraudReportId', async (req, res) => {
  try {
    const { fraudReportId } = req.params;

    const report = await FraudReport.findById(fraudReportId)
      .populate('matchedRecruiterId', 'firstName lastName email');

    if (!report) {
      return res.status(404).send('Report not found.');
    }

    const messages = await Message.find({ fraudReportId }).sort({ sentAt: 1 });

    await Message.updateMany(
      { fraudReportId, recipientType: 'system', readAt: null },
      { readAt: new Date() }
    );

    res.render('internal-dispute-detail', { report, messages, fraudReportId });
  } catch (error) {
    console.error('Error loading dispute thread:', error);
    res.status(500).send('Server error');
  }
});

// Staff reply — sends as the fixed "PreCheckd Trust & Safety" sender,
// lands in the recruiter's normal PreCheckd inbox like any other message.
router.post('/disputes/:fraudReportId/reply', async (req, res) => {
  try {
    const { fraudReportId } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).send('Reply body is required.');
    }

    const report = await FraudReport.findById(fraudReportId);
    if (!report || !report.matchedRecruiterId) {
      return res.status(404).send('Report or matched recruiter not found.');
    }

    await Message.create({
      fraudReportId,
      senderType: 'system',
      recipientType: 'recruiter',
      recipientId: report.matchedRecruiterId,
      body: body.trim(),
    });

    res.redirect(`/disputes/${fraudReportId}`);
  } catch (error) {
    console.error('Error replying to dispute thread:', error);
    res.status(500).send('Server error');
  }
});

// Update a single report's status from the detail view
router.post('/fraud/:reportId/status', async (req, res) => {
  try {
    const { status, redirectTo } = req.body;
    const validStatuses = ['pending', 'reviewed', 'dismissed', 'confirmed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).send('Invalid status.');
    }

    await FraudReport.findByIdAndUpdate(req.params.reportId, { status });
    res.redirect(redirectTo || '/fraud');
  } catch (error) {
    console.error('Error updating fraud report status:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;