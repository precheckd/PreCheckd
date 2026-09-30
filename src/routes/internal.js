const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const FraudReport = require('../models/FraudReport');
const { PUBLIC_EMAIL_DOMAINS, EMAIL_REPORT_THRESHOLD, DOMAIN_REPORT_THRESHOLD } = require('../config/fraudConfig');

const INTERNAL_ADMIN_SECRET = process.env.INTERNAL_ADMIN_SECRET;

function requireInternalAuth(req, res, next) {
  if (req.session.isInternalAdmin) {
    return next();
  }
  res.redirect('/internal/login');
}

// Login page
router.get('/login', (req, res) => {
  res.render('internal-login', { error: null });
});

router.post('/login', (req, res) => {
  const { secret } = req.body;

  if (!INTERNAL_ADMIN_SECRET) {
    return res.render('internal-login', { error: 'INTERNAL_ADMIN_SECRET is not configured on the server.' });
  }

  if (secret === INTERNAL_ADMIN_SECRET) {
    req.session.isInternalAdmin = true;
    return res.redirect('/internal');
  }

  res.render('internal-login', { error: 'Incorrect password.' });
});

router.get('/logout', (req, res) => {
  req.session.isInternalAdmin = false;
  res.redirect('/internal/login');
});

router.use(requireInternalAuth);

// Landing dashboard — links out to each internal tool
router.get('/', async (req, res) => {
  try {
    const [candidateCount, flaggedCount] = await Promise.all([
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
    ]);

    res.render('internal-dashboard', {
      candidateCount,
      flaggedCount: flaggedCount[0]?.total || 0,
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

    res.redirect(`/internal/verify/${candidate._id}`);
  } catch (error) {
    console.error('Error toggling verification status:', error);
    res.status(500).send('Server error');
  }
});

// Fraud dashboard
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
      { $match: { distinctReporters: { $gte: EMAIL_REPORT_THRESHOLD } } },
      { $sort: { distinctReporters: -1, latest: -1 } },
    ]);

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
      { $match: { distinctReporters: { $gte: DOMAIN_REPORT_THRESHOLD } } },
      { $sort: { distinctReporters: -1, latest: -1 } },
    ]);

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
      .populate('matchedRecruiterId', 'firstName lastName email slug isIdentityVerified');

    res.render('internal-fraud-detail', {
      targetLabel: reportedEmail,
      targetType: 'email',
      reports,
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
      .populate('matchedRecruiterId', 'firstName lastName email slug isIdentityVerified');

    res.render('internal-fraud-detail', {
      targetLabel: reportedDomain,
      targetType: 'domain',
      reports,
    });
  } catch (error) {
    console.error('Error loading fraud detail (domain):', error);
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
    res.redirect(redirectTo || '/internal/fraud');
  } catch (error) {
    console.error('Error updating fraud report status:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;