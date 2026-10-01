const express = require('express');
const router = express.Router();
const ConnectionRequest = require('../models/ConnectionRequest');
const FraudReport = require('../models/FraudReport');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  next();
}

router.use(requireCandidateLogin);

// GET /candidate-dashboard/my-reports — reports this candidate filed while
// logged in. Deliberately minimal: just a receipt that it was submitted
// (date, who they reported, why, what they said) — no status, since
// nothing here has been reviewed and showing a verdict invites a
// "why was it dismissed" conversation this isn't set up to have.
router.get('/my-reports', async (req, res) => {
  try {
    const reports = await FraudReport.find({ reporterCandidateId: req.session.candidateId })
      .sort({ createdAt: -1 });

    const reportsForView = reports.map((r) => ({
      reportedEmail: r.reportedEmail,
      reasonCategory: r.reasonCategory,
      description: r.description,
      createdAt: r.createdAt,
    }));

    res.render('candidate-my-reports', { reports: reportsForView });
  } catch (error) {
    console.error('Error loading candidate reports:', error);
    res.status(500).send('Server error');
  }
});

// GET /candidate-dashboard/requests — list of everything this candidate has sent
router.get('/requests', async (req, res) => {
  try {
    const requests = await ConnectionRequest.find({ candidateId: req.session.candidateId })
      .populate('recruiterId')
      .sort({ createdAt: -1 });

    const requestsForView = requests.map((r) => {
      const recruiter = r.recruiterId;
      return {
        _id: r._id,
        status: r.status,
        note: r.note,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt,
        recruiter: {
          name: `${recruiter.firstName} ${recruiter.lastName}`,
          company: recruiter.company && recruiter.company !== 'Not provided' ? recruiter.company : null,
          slug: recruiter.slug,
          photoUrl: recruiter.profilePhotoUrl,
          email: r.status === 'accepted' ? recruiter.email : null
        }
      };
    });

    res.render('candidate-requests', { requests: requestsForView });
  } catch (error) {
    console.error('Error loading candidate requests:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;