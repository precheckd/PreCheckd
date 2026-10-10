const express = require('express');
const router = express.Router();
const multer = require('multer');
const Candidate = require('../models/Candidate');
const { uploadCandidatePhoto, uploadResume, deleteS3Object } = require('../utils/s3Upload');
const { parseResume } = require('../utils/resumeParser');
const { syncWithCredly } = require('../utils/credlyVerification');
const { getMissingMatchingRequirements } = require('../utils/candidateMatchingRequirements');
const { parseExpiry } = require('../utils/certExpiry');

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

// requiredFields defaults to matchFields when omitted — pass it explicitly
// when one of the match fields (e.g. certifications' credentialId) is
// optional in the form and shouldn't cause the whole entry to be dropped
// just because it's blank.
function mergeEntries(newEntries, existingEntries, matchFields, requiredFields) {
  if (!Array.isArray(newEntries)) return [];
  const fieldsThatMustBePresent = requiredFields || matchFields;

  const keyFor = (e) => matchFields.map((f) => (e[f] || '').toString().trim().toLowerCase()).join('|');

  const existingByKey = new Map(
    (existingEntries || []).map((e) => [keyFor(e), e])
  );

  return newEntries
    .filter((e) => fieldsThatMustBePresent.every((f) => e[f] && e[f].toString().trim()))
    .map((e) => {
      const existing = existingByKey.get(keyFor(e));
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

// mergeEntries keeps an existing entry untouched when its name + credential
// ID are unchanged, which would drop an edited expiry date. This copies the
// submitted expiry onto the merged entries (matched the same way). A later
// Credly sync still overrides it for certs that match a Credly badge.
function applySubmittedExpiry(mergedCerts, submittedCerts) {
  const keyFor = (c) => `${(c.name || '').toString().trim().toLowerCase()}|${(c.credentialId || '').toString().trim().toLowerCase()}`;
  const submittedByKey = new Map((submittedCerts || []).map((c) => [keyFor(c), c]));

  mergedCerts.forEach((cert) => {
    const submitted = submittedByKey.get(keyFor(cert));
    if (!submitted) return;
    const next = parseExpiry(submitted.expiresAt);
    const current = parseExpiry(cert.expiresAt);
    if ((next && next.getTime()) !== (current && current.getTime())) {
      cert.expiresAt = next;
    }
  });
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
      error: null,
      missingRequirements: getMissingMatchingRequirements(candidate)
    });
  } catch (error) {
    console.error('Error loading candidate edit page:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate/:slug/edit/recheck-credly — re-runs the Credly check on
// demand, so a cert earned after signup can be picked up without having to
// re-save the whole form. Verifies any matching existing certs and queues
// new badges for the candidate to add or dismiss.
router.post('/:slug/edit/recheck-credly', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    const username = typeof req.body.credlyUsername === 'string' ? req.body.credlyUsername.trim() : '';
    if (!username && !candidate.credlyUsername) {
      return res.status(400).json({ error: 'Enter your Credly username first, then check again.' });
    }

    const verifiedBefore = candidate.certifications.filter((c) => c.verified).length;

    try {
      await syncWithCredly(candidate, username);
    } catch (syncError) {
      return res.status(400).json({ error: syncError.message });
    }

    await candidate.save();

    const verifiedNow = candidate.certifications.filter((c) => c.verified).length;

    res.json({
      success: true,
      newlyVerified: verifiedNow - verifiedBefore,
      newBadges: (candidate.credlyUnmatchedBadges || []).length
    });
  } catch (error) {
    console.error('Error rechecking Credly:', error);
    res.status(500).json({ error: 'Something went wrong checking Credly. Please try again.' });
  }
});

// POST /candidate/:slug/public-page — owner switches their public
// /verify/:slug page on or off. Only fully verified candidates can turn it
// on, so the public page never has to say "not verified yet".
router.post('/:slug/public-page', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    const enabled = typeof req.body.enabled === 'undefined'
      ? candidate.publicVerifyPage === true
      : (req.body.enabled === true || req.body.enabled === 'true');

    if (enabled && !(candidate.isPhoneVerified && candidate.isIdentityVerified)) {
      return res.status(400).json({ error: 'Finish phone and identity verification first, then you can turn on your public page.' });
    }

    candidate.publicVerifyPage = enabled;

    // Section checkboxes (any subset may be sent).
    const sent = req.body.sections && typeof req.body.sections === 'object' ? req.body.sections : {};
    ['certifications', 'degrees', 'jobTitles'].forEach((key) => {
      if (typeof sent[key] === 'boolean') {
        candidate.set(`publicSections.${key}`, sent[key]);
      }
    });

    await candidate.save();

    res.json({
      success: true,
      enabled: candidate.publicVerifyPage,
      sections: {
        certifications: candidate.publicSections.certifications !== false,
        degrees: candidate.publicSections.degrees === true,
        jobTitles: candidate.publicSections.jobTitles === true
      },
      url: `/verify/${candidate.slug}`
    });
  } catch (error) {
    console.error('Error updating public verification page setting:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /candidate/:slug/edit/add-credly-badge — candidate opts to add one
// of the unmatched badges found during a sync as a real certification entry.
router.post('/:slug/edit/add-credly-badge', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    const { badgeId } = req.body;
    const badge = (candidate.credlyUnmatchedBadges || []).find((b) => b.badgeId === badgeId);

    if (!badge) {
      return res.status(400).json({ error: 'That badge was not found in your pending Credly badges.' });
    }

    candidate.certifications.push({
      name: badge.name,
      credentialId: null,
      verified: true,
      verifiedAt: badge.issuedAt ? new Date(badge.issuedAt) : new Date(),
      expiresAt: parseExpiry(badge.expiresAt),
    });

    candidate.credlyUnmatchedBadges = (candidate.credlyUnmatchedBadges || []).filter((b) => b.badgeId !== badgeId);

    await candidate.save();

    res.json({ success: true, certifications: candidate.certifications });
  } catch (error) {
    console.error('Error adding Credly badge:', error);
    res.status(500).json({ error: 'Something went wrong adding that certification.' });
  }
});

// POST /candidate/:slug/edit/dismiss-credly-badge — candidate opts NOT to
// add one of the unmatched badges; removes it from the pending list.
router.post('/:slug/edit/dismiss-credly-badge', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    const { badgeId } = req.body;
    candidate.credlyUnmatchedBadges = (candidate.credlyUnmatchedBadges || []).filter((b) => b.badgeId !== badgeId);

    await candidate.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error dismissing Credly badge:', error);
    res.status(500).json({ error: 'Something went wrong.' });
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
          error: uploadError.message,
          missingRequirements: getMissingMatchingRequirements(candidate)
        });
      }
    }

    candidate.workHistory = mergeEntries(submittedWorkHistory, candidate.workHistory, ['jobTitle', 'employerName', 'startDate']);
    candidate.educationHistory = mergeEntries(submittedEducationHistory, candidate.educationHistory, ['schoolName', 'degree', 'graduationDate']);
    candidate.certifications = mergeEntries(submittedCertifications, candidate.certifications, ['name', 'credentialId'], ['name']);
    applySubmittedExpiry(candidate.certifications, submittedCertifications);

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
        error: resumeParseError || credlyError,
        missingRequirements: getMissingMatchingRequirements(candidate)
      });
    }

    res.redirect(`/candidate/${candidate.slug}`);
  } catch (error) {
    console.error('Error saving candidate edit:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;