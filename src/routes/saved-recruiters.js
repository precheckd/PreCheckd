const express = require('express');
const router = express.Router();
const SavedRecruiter = require('../models/SavedRecruiter');
const Recruiter = require('../models/Recruiter');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).json({ error: 'You must be logged in as a candidate to do this.' });
  }
  next();
}

router.use(requireCandidateLogin);

// GET /api/saved-recruiters/status/:slug — is this recruiter already saved
// by the current candidate? Powers the Save/Saved button's initial state.
router.get('/status/:slug', async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ slug: req.params.slug });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    const existing = await SavedRecruiter.findOne({
      candidateId: req.session.candidateId,
      recruiterId: recruiter._id
    });

    res.json({ saved: Boolean(existing) });
  } catch (error) {
    console.error('Error checking saved-recruiter status:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/saved-recruiters/save — bookmark a recruiter
router.post('/save', async (req, res) => {
  try {
    const { recruiterSlug } = req.body;

    const recruiter = await Recruiter.findOne({ slug: recruiterSlug, isActive: true });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    try {
      await SavedRecruiter.create({
        candidateId: req.session.candidateId,
        recruiterId: recruiter._id
      });
    } catch (error) {
      // Duplicate key error just means it's already saved — treat as success,
      // not a failure, since the end state the candidate wants is the same.
      if (error.code !== 11000) throw error;
    }

    res.json({ success: true, saved: true });
  } catch (error) {
    console.error('Error saving recruiter:', error);
    res.status(500).json({ error: 'Something went wrong saving this recruiter.' });
  }
});

// POST /api/saved-recruiters/unsave — remove a bookmark
router.post('/unsave', async (req, res) => {
  try {
    const { recruiterSlug } = req.body;

    const recruiter = await Recruiter.findOne({ slug: recruiterSlug });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    await SavedRecruiter.deleteOne({
      candidateId: req.session.candidateId,
      recruiterId: recruiter._id
    });

    res.json({ success: true, saved: false });
  } catch (error) {
    console.error('Error unsaving recruiter:', error);
    res.status(500).json({ error: 'Something went wrong removing this recruiter.' });
  }
});

module.exports = router;