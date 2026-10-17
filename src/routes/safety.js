const express = require('express');
const router = express.Router();
const FraudReport = require('../models/FraudReport');

// Safety Center (logged-in candidates): the sender-email checker, the report
// form and the receipts of reports they've filed, on one page with tabs. The
// public /fraud page stays as it is for people who aren't members.
function requireCandidate(req, res, next) {
  if (!req.session.candidateId) return res.redirect('/login');
  next();
}
router.use(requireCandidate);

const TABS = ['check', 'report', 'reports'];

router.get('/', async (req, res) => {
  try {
    const tab = TABS.includes(req.query.tab) ? req.query.tab : 'check';

    // One-time messages left by POST /fraud/report.
    const flash = req.session.safetyFlash || null;
    req.session.safetyFlash = null;
    const filed = req.query.filed === '1' ? (req.session.safetyFiled || {}) : null;
    if (filed) req.session.safetyFiled = null;

    const reports = await FraudReport.find({ reporterCandidateId: req.session.candidateId }).sort({ createdAt: -1 });
    const reportsForView = reports.map((r) => ({
      reportedEmail: r.reportedEmail,
      reasonCategory: r.reasonCategory,
      description: r.description,
      createdAt: r.createdAt
    }));

    res.render('safety', {
      pageTitle: 'Safety Center | PreCheckd',
      tab,
      reports: reportsForView,
      error: flash ? flash.error : null,
      form: flash ? flash.form : {},
      filed
    });
  } catch (error) {
    console.error('Error loading Safety Center:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
