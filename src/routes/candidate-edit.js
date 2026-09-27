const express = require('express');
const router = express.Router();
const multer = require('multer');
const Candidate = require('../models/Candidate');
const { uploadCandidatePhoto, uploadResume, deleteS3Object } = require('../utils/s3Upload');
const { parseResume } = require('../utils/resumeParser');
const { fetchCredlyBadges, findMatchingBadge, tryCredlyAutoGuess } = require('../utils/credlyVerification');

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

// Runs a candidate's certifications against a fetched Credly badge wallet,
// marking any matches as verified with the badge's real issue date. Never
// un-verifies a cert that was already verified by some other means — only
// adds verification, never removes it.
function applyCredlyMatches(certifications, badges) {
  return certifications.map((cert) => {
    if (cert.verified) return cert;

    const match = findMatchingBadge(cert.name, badges);
    if (!match) return cert;

    return {
      ...cert,
      verified: true,
      verifiedAt: match.issued_at_date ? new Date(match.issued_at_date) : new Date(),
    };
  });
}

// Attempts to sync a candidate's certifications against Credly — either
// using their already-stored username, a newly-provided one from the edit
// form, or a background auto-guess if neither exists yet. Mutates
// candidate.certifications and candidate.credlyUsername/credlyLastSyncedAt
// in place; never throws — sync failures are silent, since Credly is a
// bonus verification path, not a required one.
async function syncWithCredly(candidate, providedUsername) {
  const usernameToTry = (providedUsername && providedUsername.trim())
    ? providedUsername.trim()
    : candidate.credlyUsername;

  if (usernameToTry) {
    try {
      const badges = await fetchCredlyBadges(usernameToTry);
      candidate.credlyUsername = usernameToTry;
      candidate.credlyLastSyncedAt = new Date();
      candidate.certifications = applyCredlyMatches(candidate.certifications, badges);
      return;
    } catch (error) {
      // A manually-provided username that fails is worth surfacing;
      // an already-stored one that starts failing (profile went private,
      // etc.) is not worth interrupting the save over.
      if (providedUsername) {
        throw new Error('Could not find a public Credly profile for that username. Please double-check it and try again.');
      }
      return;
    }
  }

  // No username at all yet — try the silent background auto-guess.
  const guess = await tryCredlyAutoGuess(candidate.firstName, candidate.lastName);
  if (guess) {
    candidate.credlyUsername = guess.username;
    candidate.credlyLastSyncedAt = new Date();
    candidate.certifications = applyCredlyMatches(candidate.certifications, guess.badges);
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

    const { bio, credlyUsername } = req.body;
    const submittedWorkHistory = parseJsonField(req.body.workHistory);
    const submittedEducationHistory = parseJsonField(req.body.educationHistory);
    const submittedCertifications = parseJsonField(req.body.certifications);

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

    // First, apply whatever the candidate manually edited/added in the form
    // (existing entries merge to preserve verified status; new ones start
    // unverified).
    candidate.workHistory = mergeEntries(submittedWorkHistory, candidate.workHistory, ['jobTitle', 'employerName', 'startDate']);
    candidate.educationHistory = mergeEntries(submittedEducationHistory, candidate.educationHistory, ['schoolName', 'degree', 'graduationDate']);
    candidate.certifications = mergeEntries(submittedCertifications, candidate.certifications, ['name', 'credentialId']);

    // Then, if a resume was uploaded, parse it and layer in anything the
    // candidate didn't already provide via the form above.
    let resumeParseError = null;
    if (resumeFile) {
      try {
        const resumeUrl = await uploadResume(candidate._id.toString(), resumeFile);
        candidate.resumeUrl = resumeUrl;

        const parsed = await parseResume(resumeFile);

        if (!candidate.bio) {
          candidate.bio = parsed.bio;
        }
        if (candidate.workHistory.length === 0) {
          candidate.workHistory = parsed.workHistory.map((job) => ({
            ...job,
            verified: false,
            verifiedAt: null
          }));
        }
        if (candidate.educationHistory.length === 0) {
          candidate.educationHistory = parsed.educationHistory.map((edu) => ({
            ...edu,
            verified: false,
            verifiedAt: null
          }));
        }
        if (candidate.certifications.length === 0) {
          candidate.certifications = parsed.certifications;
        }
      } catch (parseError) {
        console.error('Resume parsing failed on edit page:', parseError);
        resumeParseError = 'We saved your resume, but couldn\'t automatically read it. Please add your details manually below.';
      }
    }

    // Sync against Credly last, after all certification entries (manual,
    // merged, or resume-parsed) are finalized — this is the pass that
    // actually marks matching certs as verified.
    let credlyError = null;
    try {
      await syncWithCredly(candidate, credlyUsername);
    } catch (error) {
      credlyError = error.message;
    }

    await candidate.save();

    if (resumeParseError || credlyError) {
      return res.render('candidate-edit', {
        candidate,
        title: `Edit Profile | PreCheckd`,
        error: resumeParseError || credlyError
      });
    }

    res.redirect(`/candidate/${candidate.slug}`);
  } catch (error) {
    console.error('Error saving candidate edit:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;