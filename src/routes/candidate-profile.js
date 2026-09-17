const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  next();
}

// GET /candidate/:slug — private, owner-only
router.get('/:slug', requireCandidateLogin, async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).send('You do not have permission to view this page.');
    }

    res.render('candidate-profile', {
      candidate,
      title: `${candidate.firstName} ${candidate.lastName} | PreCheckd`
    });
  } catch (error) {
    console.error('Error loading candidate profile:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;