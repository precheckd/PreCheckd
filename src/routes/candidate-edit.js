const express = require('express');
const router = express.Router();
const multer = require('multer');
const Candidate = require('../models/Candidate');
const { uploadCandidatePhoto, deleteS3Object } = require('../utils/s3Upload');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  next();
}

router.use(requireCandidateLogin);

function parseJsonField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

// GET /candidate/:slug/edit — owner-only edit form
router.get('/:slug/edit', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).send('You do not have permission to edit this profile.');
    }

    res.render('candidate-edit', {
      candidate,
      title: `Edit Profile | PreCheckd`,
      error: null
    });
  } catch (error) {
    console.error('Error loading candidate edit page:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate/:slug/edit — save changes, owner-only
router.post('/:slug/edit', upload.single('profilePhoto'), async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).send('You do not have permission to edit this profile.');
    }

    const { bio } = req.body;
    const workHistory = parseJsonField(req.body.workHistory);
    const educationHistory = parseJsonField(req.body.educationHistory);
    const certifications = parseJsonField(req.body.certifications);

    candidate.bio = bio && bio.trim() ? bio.trim().slice(0, 1000) : null;

    if (req.file) {
      try {
        const oldPhotoUrl = candidate.profilePhotoUrl;
        const newPhotoUrl = await uploadCandidatePhoto(candidate._id.toString(), req.file);
        candidate.profilePhotoUrl = newPhotoUrl;
        await deleteS3Object(oldPhotoUrl);
      } catch (uploadError) {
        return res.status(400).render('candidate-edit', {
          candidate,
          title: `Edit Profile | PreCheckd`,
          error: uploadError.message
        });
      }
    }

    function mergeEntries(newEntries, existingEntries, matchFields) {
      if (!Array.isArray(newEntries)) return [];

      const existingByKey = new Map(
        (existingEntries || []).map((e) => [
          matchFields.map((f) => (e[f] || '').toString().toLowerCase()).join('|'),
          e
        ])
      );

      return newEntries
        .filter((e) => matchFields.every((f) => e[f] && e[f].toString().trim()))
        .map((e) => {
          const key = matchFields.map((f) => e[f].toString().trim().toLowerCase()).join('|');
          const existing = existingByKey.get(key);
          if (existing) {
            return existing;
          }
          return {
            ...e,
            verified: false,
            verifiedAt: null
          };
        });
    }

    candidate.workHistory = mergeEntries(
      workHistory,
      candidate.workHistory,
      ['jobTitle', 'employerName', 'startDate']
    );

    candidate.educationHistory = mergeEntries(
      educationHistory,
      candidate.educationHistory,
      ['schoolName', 'degree', 'graduationDate']
    );

    candidate.certifications = mergeEntries(
      certifications,
      candidate.certifications,
      ['name', 'credentialId']
    );

    await candidate.save();

    res.redirect(`/candidate/${candidate.slug}`);
  } catch (error) {
    console.error('Error saving candidate edit:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;