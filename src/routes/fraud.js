const express = require('express');
const router = express.Router();
const multer = require('multer');
const FraudReport = require('../models/FraudReport');
const Recruiter = require('../models/Recruiter');
const { uploadFraudEvidence, validateEvidenceFile } = require('../utils/s3Upload');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PUBLIC_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'gmx.com', 'yandex.com', 'zoho.com'
];

const MAX_REPORTS_PER_EMAIL_PER_DAY = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/', (req, res) => {
  res.render('fraud', { error: null, success: false });
});

router.post('/report', upload.single('evidenceScreenshot'), async (req, res) => {
  try {
    const {
      reporterEmail,
      contactConsent,
      reportedEmail,
      incidentDate,
      reasonCategory,
      description,
      evidenceText,
    } = req.body;

    if (!reporterEmail || !EMAIL_REGEX.test(reporterEmail.trim())) {
      return res.render('fraud', { error: 'Please provide a valid email address for yourself.', success: false });
    }
    if (!reportedEmail || !EMAIL_REGEX.test(reportedEmail.trim())) {
      return res.render('fraud', { error: 'Please provide a valid email address for the recruiter you are reporting.', success: false });
    }
    if (!reasonCategory) {
      return res.render('fraud', { error: 'Please select a reason.', success: false });
    }
    if (!description || !description.trim()) {
      return res.render('fraud', { error: 'Please describe what happened.', success: false });
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
      return res.render('fraud', { error: 'You have submitted the maximum number of reports for today. Please try again tomorrow.', success: false });
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
      contactConsent: contactConsent === 'on' || contactConsent === 'true',
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
        return res.render('fraud', { error: validation.error, success: false });
      }
      report.evidenceScreenshotUrl = await uploadFraudEvidence(report._id, req.file);
    }

    await report.save();

    res.render('fraud', { error: null, success: true });
  } catch (error) {
    console.error('Error submitting fraud report:', error);
    res.render('fraud', { error: 'Something went wrong submitting your report. Please try again.', success: false });
  }
});

module.exports = router;