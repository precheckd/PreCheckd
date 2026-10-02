const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const FraudReport = require('../models/FraudReport');
const Message = require('../models/Message');
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

    res.render('internal-dashboard', {
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
    res.render('internal-verify-detail', { candidate });
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