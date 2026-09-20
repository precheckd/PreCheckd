const express = require('express');
const router = express.Router();
const multer = require('multer');
const Candidate = require('../models/Candidate');
const { uploadCandidatePhoto, uploadResume, deleteS3Object } = require('../utils/s3Upload');
const { parseResume } = require('../utils/resumeParser');

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
router.post('/:slug/edit', upload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'resume', maxCount: 1 }
]), async (req, res) => {
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

    const photoFile = req.files?.profilePhoto?.[0];
    const resumeFile = req.files?.resume?.[0];

    if (photoFile) {
      try {
        const oldPhotoUrl = candidate.profilePhotoUrl;
        const newPhotoUrl = await uploadCandidatePhoto(candidate._id.toString(), photoFile);
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

    // If a resume was uploaded from the edit page, parse it immediately
    // (not backgrounded like signup, since the candidate is actively
    // waiting on this page and it's a much lower-traffic moment).
    let resumeParseError = null;
    if (resumeFile) {
      try {
        const resumeUrl = await uploadResume(candidate._id.toString(), resumeFile);
        candidate.resumeUrl = resumeUrl;

        const parsed = await parseResume(resumeFile);

        // Only overwrite fields the candidate hasn't already filled in
        // themselves, so re-uploading a resume doesn't clobber manual edits
        // they may have made since signup.
        if (!candidate.bio) {
          candidate.bio = parsed.bio;
        }
        if (!candidate.workHistory || candidate.workHistory.length === 0) {
          candidate.workHistory = parsed.workHistory;
        }
        if (!candidate.educationHistory || candidate.educationHistory.length === 0) {
          candidate.educationHistory = parsed.educationHistory;
        }
        if (!candidate.certifications || candidate.certifications.length === 0) {
          candidate.certifications = parsed.certifications;
        }
      } catch (parseError) {
        console.error('Resume parsing failed on edit page:', parseError);
        resumeParseError = 'We saved your resume, but couldn\'t automatically read it. Please add your details manually below.';
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

    // If the resume just populated fresh data above, and the form's
    // submitted arrays are empty (candidate hadn't added anything before
    // uploading), skip the merge so we don't immediately overwrite what
    // the resume just filled in.
    if (workHistory.length > 0 || candidate.workHistory.length === 0) {
      candidate.workHistory = mergeEntries(workHistory, candidate.workHistory, ['jobTitle', 'employerName', 'startDate']);
    }
    if (educationHistory.length > 0 || candidate.educationHistory.length === 0) {
      candidate.educationHistory = mergeEntries(educationHistory, candidate.educationHistory, ['schoolName', 'degree', 'graduationDate']);
    }
    if (certifications.length > 0 || candidate.certifications.length === 0) {
      candidate.certifications = mergeEntries(certifications, candidate.certifications, ['name', 'credentialId']);
    }

    await candidate.save();

    if (resumeParseError) {
      return res.render('candidate-edit', {
        candidate,
        title: `Edit Profile | PreCheckd`,
        error: resumeParseError
      });
    }

    res.redirect(`/candidate/${candidate.slug}`);
  } catch (error) {
    console.error('Error saving candidate edit:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;