const express = require('express');
const router = express.Router();
const multer = require('multer');
const FraudReport = require('../models/FraudReport');
const Recruiter = require('../models/Recruiter');
const { uploadFraudEvidence, validateEvidenceFile } = require('../utils/s3Upload');
const { createCoupon } = require('../utils/couponGenerator');
const { PUBLIC_EMAIL_DOMAINS } = require('../config/fraudConfig');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const MAX_REPORTS_PER_EMAIL_PER_DAY = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Defaults for the fraud-report thank-you coupon. Adjust here if the
// offer changes — single source of truth for this flow.
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

    const report = new FraudReport({
      reporterEmail: normalizedReporterEmail,
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
      // A coupon-generation failure should never block the fraud report
      // itself from succeeding — log it and move on without a code.
      console.error('Could not generate thank-you coupon:', couponError);
    }

    res.render('fraud', { error: null, success: true, couponCode });
  } catch (error) {
    console.error('Error submitting fraud report:', error);
    res.render('fraud', { error: 'Something went wrong submitting your report. Please try again.', success: false, couponCode: null });
  }
});

module.exports = router;