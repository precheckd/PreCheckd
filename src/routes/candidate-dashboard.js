const express = require('express');
const router = express.Router();
const ConnectionRequest = require('../models/ConnectionRequest');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  next();
}

router.use(requireCandidateLogin);

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