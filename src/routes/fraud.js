const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const FraudReport = require('../models/FraudReport');
const Recruiter = require('../models/Recruiter');
const Message = require('../models/Message');
const { uploadFraudEvidence, validateEvidenceFile } = require('../utils/s3Upload');
const { createCoupon } = require('../utils/couponGenerator');
const {
  sendFraudReportThankYouEmail,
  sendFraudClaimInviteEmail,
  sendFraudReportNoticeEmail,
  sendFraudReporterVerificationEmail,
  generateVerificationToken,
  generateSixDigitCode,
} = require('../services/emailService');
const { PUBLIC_EMAIL_DOMAINS } = require('../config/fraudConfig');

// At most one "you were named in a report" notice per account per day,
// so several same-day reports against the same person don't pile up into
// a string of emails that reads like harassment.
const NOTICE_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

// Reporter-email verification (proves they own the address they typed,
// before it's allowed to create a claim account or email anyone).
const REPORTER_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REPORTER_CODE_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds between sends

// Claim links are emailed, unprompted, to someone who may not check their
// inbox right away — longer-lived than the 30-minute forgot-password window.
const CLAIM_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// IP-based rate limit for /request-code — the one endpoint that emails a
// real inbox on every call, so it's the one worth capping against someone
// hammering it with a string of made-up addresses. No real reporter should
// ever get near this; it's purely an anti-abuse backstop, not a throttle on
// legitimate traffic. In-memory is fine here — a single Render instance,
// and worst case on a restart is the limit resets early, not that it fails
// to limit anything.
const IP_RATE_LIMIT_MAX = 10;
const IP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ipRequestLog = new Map(); // ip -> array of request timestamps (ms)

function isOverIpRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - IP_RATE_LIMIT_WINDOW_MS;

  const timestamps = (ipRequestLog.get(ip) || []).filter((t) => t > windowStart);

  if (timestamps.length >= IP_RATE_LIMIT_MAX) {
    ipRequestLog.set(ip, timestamps);
    return true;
  }

  timestamps.push(now);
  ipRequestLog.set(ip, timestamps);
  return false;
}

// Builds a unique slug from the reported email's local part. Claim accounts
// have no real name yet (the reporter only gives an email), so this is a
// placeholder — it's never shown publicly since isActive stays false until
// the account is verified.
async function makeClaimSlug(email) {
  const base = email.split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'recruiter';

  const existing = await Recruiter.findOne({ slug: base });
  if (!existing) {
    return base;
  }

  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

// Creates the unverified "claim" account for a flagged email that doesn't
// match any existing recruiter, and emails them a one-time claim link.
// Never blocks the report itself — a failure here is logged, not thrown.
async function createClaimAccountAndInvite(normalizedReportedEmail) {
  try {
    const slug = await makeClaimSlug(normalizedReportedEmail);

    const claimAccount = new Recruiter({
      firstName: normalizedReportedEmail.split('@')[0],
      lastName: null,
      slug,
      email: normalizedReportedEmail,
      accountTier: 'unverified_claim',
      isActive: false,
    });

    const token = generateVerificationToken();
    claimAccount.loginToken = token;
    claimAccount.loginTokenExpires = Date.now() + CLAIM_TOKEN_TTL_MS;

    await claimAccount.save();

    sendFraudClaimInviteEmail(normalizedReportedEmail, token).catch((emailError) => {
      console.error('Failed to send fraud claim invite email:', emailError);
    });

    return claimAccount;
  } catch (error) {
    console.error('Failed to create claim account for flagged email:', error);
    return null;
  }
}

// Notifies an already-active account (standard, or a claim account that's
// since set a password — either way, `passwordHash` is the real signal
// that there's a dashboard for them to check) that a new report named them.
// Only called for an exact email match, never a domain match — a domain
// match points at a specific *different* person at the same company, and
// emailing the wrong named individual "you were reported" is exactly the
// kind of mistake this has to avoid.
//
// Two separate things happen here, on two separate schedules:
//   - An in-platform message, tied to this exact report via fraudReportId,
//     giving them somewhere to actually reply/dispute it. Created every
//     time — a quiet inbox item isn't the harassment risk a string of
//     emails would be, so this isn't debounced.
//   - The external email notice, still capped at once per 24 hours so
//     several same-day reports don't read as a pile-on.
async function maybeNotifyExistingAccount(recruiterId, reportId) {
  try {
    const account = await Recruiter.findById(recruiterId);
    if (!account || !account.passwordHash) {
      return false; // no usable dashboard to send them to yet
    }

    Message.create({
      senderType: 'system',
      recipientType: 'recruiter',
      recipientId: account._id,
      fraudReportId: reportId,
      subject: 'A report was filed about your account',
      body: 'A candidate submitted feedback on PreCheckd mentioning your account. This hasn\'t been reviewed or verified by PreCheckd — we\'re letting you know right away, for transparency, so you have the chance to respond. Reply here if you\'d like to share your side or dispute it.',
    }).catch((messageError) => {
      console.error('Failed to create fraud dispute thread message:', messageError);
    });

    const recentlyNotified = account.lastFraudNotifiedAt
      && (Date.now() - account.lastFraudNotifiedAt.getTime()) < NOTICE_DEBOUNCE_MS;
    if (recentlyNotified) {
      return true; // debounced on the email only — the account was still contacted via the in-platform message above
    }

    account.lastFraudNotifiedAt = new Date();
    await account.save();

    sendFraudReportNoticeEmail(account.email).catch((emailError) => {
      console.error('Failed to send fraud report notice email:', emailError);
    });

    return true;
  } catch (error) {
    console.error('Failed to check/send fraud report notice:', error);
    return false;
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const MAX_REPORTS_PER_EMAIL_PER_DAY = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const THANKYOU_DISCOUNT_TYPE = 'percentage';
const THANKYOU_DISCOUNT_VALUE = 20;
const THANKYOU_EXPIRES_IN_DAYS = 90;

router.get('/', (req, res) => {
  res.render('fraud', { error: null, success: false, couponCode: null, step: 'gate', formValues: {} });
});

// --- Step 1: email a code to prove the reporter owns the address they typed ---
router.post('/request-code', async (req, res) => {
  try {
    if (isOverIpRateLimit(req.ip)) {
      return res.status(429).json({ error: 'Too many requests from this network. Please try again later.' });
    }

    const { reporterEmail } = req.body;

    if (!reporterEmail || !EMAIL_REGEX.test(reporterEmail.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const normalizedReporterEmail = reporterEmail.trim().toLowerCase();

    const sentAt = req.session.fraudCodeSentAt;
    if (sentAt && Date.now() - sentAt < REPORTER_CODE_RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((REPORTER_CODE_RESEND_COOLDOWN_MS - (Date.now() - sentAt)) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSeconds}s before requesting another code.` });
    }

    const code = generateSixDigitCode();
    req.session.fraudCodeEmail = normalizedReporterEmail;
    req.session.fraudCode = code;
    req.session.fraudCodeExpires = Date.now() + REPORTER_CODE_TTL_MS;
    req.session.fraudCodeSentAt = Date.now();
    req.session.fraudCodeVerified = false;

    await sendFraudReporterVerificationEmail(normalizedReporterEmail, code);

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending fraud reporter verification code:', error);
    res.status(500).json({ error: 'Something went wrong sending your code. Please try again.' });
  }
});

router.post('/report', upload.single('evidenceScreenshot'), async (req, res) => {
  const {
    reporterEmail,
    reportedEmail,
    incidentDate,
    reasonCategory,
    description,
    evidenceText,
    code,
  } = req.body;

  // Carries whatever they'd already typed back into the view on any error,
  // so a mistyped code doesn't cost them the report they just wrote out.
  const formValues = { reporterEmail, reportedEmail, incidentDate, reasonCategory, description, evidenceText };

  function renderError(message, step = 'verify') {
    return res.render('fraud', { error: message, success: false, couponCode: null, step, formValues });
  }

  try {
    if (!reporterEmail || !EMAIL_REGEX.test(reporterEmail.trim())) {
      return renderError('Please provide a valid email address for yourself.', 'gate');
    }
    if (!reportedEmail || !EMAIL_REGEX.test(reportedEmail.trim())) {
      return renderError('Please provide a valid email address for the recruiter you are reporting.');
    }
    if (!reasonCategory) {
      return renderError('Please select a reason.');
    }
    if (!description || !description.trim()) {
      return renderError('Please describe what happened.');
    }

    const normalizedReporterEmail = reporterEmail.trim().toLowerCase();

    // Reporter-email verification — proves they actually own this address
    // before anything downstream (claim account, notification email) fires.
    if (!req.session.fraudCode || req.session.fraudCodeEmail !== normalizedReporterEmail) {
      return renderError('Please request a new verification code for this email address.', 'gate');
    }
    if (Date.now() > req.session.fraudCodeExpires) {
      return renderError('Your verification code expired. Please request a new one.', 'gate');
    }
    if (!code || code.trim() !== req.session.fraudCode) {
      return renderError('Incorrect verification code. Please try again.');
    }

    // Single-use — clear it now so this code can't verify a second report.
    req.session.fraudCode = null;
    req.session.fraudCodeEmail = null;
    req.session.fraudCodeExpires = null;

    const normalizedReportedEmail = reportedEmail.trim().toLowerCase();
    const reportedDomain = normalizedReportedEmail.split('@')[1] || '';

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await FraudReport.countDocuments({
      reporterEmail: normalizedReporterEmail,
      createdAt: { $gte: since },
    });
    if (recentCount >= MAX_REPORTS_PER_EMAIL_PER_DAY) {
      return renderError('You have submitted the maximum number of reports for today. Please try again tomorrow.');
    }

    // A logged-in candidate could otherwise dodge the cap above by just
    // verifying a different throwaway email each time — this closes that
    // off by also capping per-account, regardless of which email they
    // verified with. Doesn't apply to a logged-out submission; there's no
    // account to tie it to.
    if (req.session.candidateId) {
      const recentAccountCount = await FraudReport.countDocuments({
        reporterCandidateId: req.session.candidateId,
        createdAt: { $gte: since },
      });
      if (recentAccountCount >= MAX_REPORTS_PER_EMAIL_PER_DAY) {
        return renderError('You have submitted the maximum number of reports for today. Please try again tomorrow.');
      }
    }

    let matchedRecruiterId = null;
    let matchType = null;

    const exactMatch = await Recruiter.findOne({ email: normalizedReportedEmail });
    if (exactMatch) {
      matchedRecruiterId = exactMatch._id;
      matchType = 'email';
    } else if (reportedDomain && !PUBLIC_EMAIL_DOMAINS.includes(reportedDomain)) {
      const escapedDomain = reportedDomain.replace(/\./g, '\\.');
      const domainMatch = await Recruiter.findOne({ email: new RegExp(`@${escapedDomain}$`, 'i') });
      if (domainMatch) {
        matchedRecruiterId = domainMatch._id;
        matchType = 'domain';
      }
    }

    // No existing recruiter at all (by email or domain) — create the
    // unverified claim account and invite them to see what was reported.
    // A later report against the same email will find this account via
    // the exact-email match above, so this only ever fires once per email.
    // Skipped for personal email providers (gmail.com, etc.) — there's no
    // company identity to tie the account to, and it's far more likely to
    // be a wrong-number-style mistaken report than a real recruiter.
    if (!matchedRecruiterId && !PUBLIC_EMAIL_DOMAINS.includes(reportedDomain)) {
      const claimAccount = await createClaimAccountAndInvite(normalizedReportedEmail);
      if (claimAccount) {
        matchedRecruiterId = claimAccount._id;
        matchType = 'email';
      }
    }

    const report = new FraudReport({
      reporterEmail: normalizedReporterEmail,
      reporterCandidateId: req.session.candidateId || null,
      reportedEmail: normalizedReportedEmail,
      reportedDomain,
      incidentDate: incidentDate ? new Date(incidentDate) : undefined,
      reasonCategory,
      description: description.trim(),
      evidenceText: evidenceText ? evidenceText.trim() : undefined,
      matchedRecruiterId,
      matchType,
      ipAddress: req.ip,
    });

    // Exact match to an account that already existed before this report
    // (not the claim-creation branch above, so it's either a standard
    // recruiter or a previously claimed account — a brand-new claim
    // account has no passwordHash yet, so this is a no-op for it anyway,
    // since it already got its own invite email moments ago). Needs
    // report._id, which Mongoose assigns as soon as the document above is
    // constructed, well before .save() — no need to wait for that here.
    if (matchType === 'email' && exactMatch) {
      report.recruiterNotified = await maybeNotifyExistingAccount(matchedRecruiterId, report._id);
    }

    if (req.file) {
      const validation = validateEvidenceFile(req.file);
      if (!validation.valid) {
        return renderError(validation.error);
      }
      report.evidenceScreenshotUrl = await uploadFraudEvidence(report._id, req.file);
    }

    await report.save();

    let couponCode = null;
    try {
      const coupon = await createCoupon({
        issuedToEmail: normalizedReporterEmail,
        source: 'fraud-report-thankyou',
        sourceId: report._id,
        discountType: THANKYOU_DISCOUNT_TYPE,
        discountValue: THANKYOU_DISCOUNT_VALUE,
        expiresInDays: THANKYOU_EXPIRES_IN_DAYS,
      });
      couponCode = coupon.code;
    } catch (couponError) {
      console.error('Could not generate thank-you coupon:', couponError);
    }

    try {
      await sendFraudReportThankYouEmail(normalizedReporterEmail, couponCode);
    } catch (emailError) {
      // A failed email send should never block the report itself — the
      // on-page thank-you screen still shows the coupon either way.
      console.error('Could not send fraud report thank-you email:', emailError);
    }

    res.render('fraud', { error: null, success: true, couponCode, step: 'verify', formValues: {} });
  } catch (error) {
    console.error('Error submitting fraud report:', error);
    return renderError('Something went wrong submitting your report. Please try again.');
  }
});

module.exports = router;