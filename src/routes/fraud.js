const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const FraudReport = require('../models/FraudReport');
const Recruiter = require('../models/Recruiter');
const { uploadFraudEvidence, validateEvidenceFile } = require('../utils/s3Upload');
const { createCoupon } = require('../utils/couponGenerator');
const {
  sendFraudReportThankYouEmail,
  sendFraudClaimInviteEmail,
  sendFraudReportNoticeEmail,
  generateVerificationToken,
} = require('../services/emailService');
const { PUBLIC_EMAIL_DOMAINS } = require('../config/fraudConfig');

// At most one "you were named in a report" notice per account per day,
// so several same-day reports against the same person don't pile up into
// a string of emails that reads like harassment.
const NOTICE_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

// Claim links are emailed, unprompted, to someone who may not check their
// inbox right away — longer-lived than the 30-minute forgot-password window.
const CLAIM_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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
// kind of mistake this has to avoid. Debounced to at most once per day.
async function maybeNotifyExistingAccount(recruiterId) {
  try {
    const account = await Recruiter.findById(recruiterId);
    if (!account || !account.passwordHash) {
      return; // no usable dashboard to send them to yet
    }

    const recentlyNotified = account.lastFraudNotifiedAt
      && (Date.now() - account.lastFraudNotifiedAt.getTime()) < NOTICE_DEBOUNCE_MS;
    if (recentlyNotified) {
      return; // report is still saved/linked — they'll see it next login
    }

    account.lastFraudNotifiedAt = new Date();
    await account.save();

    sendFraudReportNoticeEmail(account.email).catch((emailError) => {
      console.error('Failed to send fraud report notice email:', emailError);
    });
  } catch (error) {
    console.error('Failed to check/send fraud report notice:', error);
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const MAX_REPORTS_PER_EMAIL_PER_DAY = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const THANKYOU_DISCOUNT_TYPE = 'percentage';
const THANKYOU_DISCOUNT_VALUE = 20;
const THANKYOU_EXPIRES_IN_DAYS = 90;

router.get('/', (req, res) => {
  res.render('fraud', { error: null, success: false, couponCode: null });
});

router.post('/report', upload.single('evidenceScreenshot'), async (req, res) => {
  try {
    const {
      reporterEmail,
      reportedEmail,
      incidentDate,
      reasonCategory,
      description,
      evidenceText,
    } = req.body;

    if (!reporterEmail || !EMAIL_REGEX.test(reporterEmail.trim())) {
      return res.render('fraud', { error: 'Please provide a valid email address for yourself.', success: false, couponCode: null });
    }
    if (!reportedEmail || !EMAIL_REGEX.test(reportedEmail.trim())) {
      return res.render('fraud', { error: 'Please provide a valid email address for the recruiter you are reporting.', success: false, couponCode: null });
    }
    if (!reasonCategory) {
      return res.render('fraud', { error: 'Please select a reason.', success: false, couponCode: null });
    }
    if (!description || !description.trim()) {
      return res.render('fraud', { error: 'Please describe what happened.', success: false, couponCode: null });
    }

    const normalizedReporterEmail = reporterEmail.trim().toLowerCase();
    const normalizedReportedEmail = reportedEmail.trim().toLowerCase();
    const reportedDomain = normalizedReportedEmail.split('@')[1] || '';

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await FraudReport.countDocuments({
      reporterEmail: normalizedReporterEmail,
      createdAt: { $gte: since },
    });
    if (recentCount >= MAX_REPORTS_PER_EMAIL_PER_DAY) {
      return res.render('fraud', { error: 'You have submitted the maximum number of reports for today. Please try again tomorrow.', success: false, couponCode: null });
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
    } else if (matchType === 'email') {
      // Exact match to an existing account — not the claim-creation branch
      // above, so this is either a standard recruiter or a previously
      // claimed account. (A brand-new claim account has no passwordHash
      // yet, so maybeNotifyExistingAccount is a no-op for it regardless —
      // it already got its own invite email moments ago.)
      await maybeNotifyExistingAccount(matchedRecruiterId);
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

    if (req.file) {
      const validation = validateEvidenceFile(req.file);
      if (!validation.valid) {
        return res.render('fraud', { error: validation.error, success: false, couponCode: null });
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

    res.render('fraud', { error: null, success: true, couponCode });
  } catch (error) {
    console.error('Error submitting fraud report:', error);
    res.render('fraud', { error: 'Something went wrong submitting your report. Please try again.', success: false, couponCode: null });
  }
});

module.exports = router;