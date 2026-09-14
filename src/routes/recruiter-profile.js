const express = require('express');
const router = express.Router();
const multer = require('multer');
const Recruiter = require('../models/Recruiter');
const { uploadProfilePhoto, deleteProfilePhoto } = require('../utils/s3Upload');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, matches s3Upload.js validation
});

// GET /recruiter/:slug (e.g. /recruiter/john-doe-a1b2c3)
router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    const recruiter = await Recruiter.findOne({
      slug: slug,
      isActive: true
    });

    if (!recruiter) {
      return res.status(404).send('Recruiter not found');
    }

    const isOwner = Boolean(
      req.session.recruiterId &&
      req.session.recruiterId === recruiter._id.toString()
    );

    // Render profile
    res.render('recruiter-profile', {
      recruiter: recruiter,
      isOwner: isOwner,
      title: `${recruiter.firstName} ${recruiter.lastName} - Verified Recruiter | PreCheckd`
    });

  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).send('Server error');
  }
});

// GET /recruiter/:slug/edit — owner-only edit form
router.get('/:slug/edit', async (req, res) => {
  try {
    const slug = req.params.slug;

    const recruiter = await Recruiter.findOne({ slug: slug, isActive: true });

    if (!recruiter) {
      return res.status(404).send('Recruiter not found');
    }

    const isOwner = Boolean(
      req.session.recruiterId &&
      req.session.recruiterId === recruiter._id.toString()
    );

    if (!isOwner) {
      return res.status(403).send('You do not have permission to edit this profile.');
    }

    res.render('edit-profile', {
      recruiter: recruiter,
      title: `Edit Profile | PreCheckd`,
      error: null
    });

  } catch (err) {
    console.error('Edit profile load error:', err);
    res.status(500).send('Server error');
  }
});

// POST /recruiter/:slug/edit — save changes, owner-only
router.post('/:slug/edit', upload.single('profilePhoto'), async (req, res) => {
  try {
    const slug = req.params.slug;

    const recruiter = await Recruiter.findOne({ slug: slug, isActive: true });

    if (!recruiter) {
      return res.status(404).send('Recruiter not found');
    }

    const isOwner = Boolean(
      req.session.recruiterId &&
      req.session.recruiterId === recruiter._id.toString()
    );

    if (!isOwner) {
      return res.status(403).send('You do not have permission to edit this profile.');
    }

    const { bio, yearsOfExperience, specialties } = req.body;

    recruiter.bio = bio && bio.trim() ? bio.trim() : null;
    recruiter.yearsOfExperience = yearsOfExperience ? Number(yearsOfExperience) : null;
    recruiter.specialties = specialties
      ? specialties.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    if (req.file) {
      try {
        const oldPhotoUrl = recruiter.profilePhotoUrl;
        const newPhotoUrl = await uploadProfilePhoto(recruiter._id.toString(), req.file);
        recruiter.profilePhotoUrl = newPhotoUrl;
        await deleteProfilePhoto(oldPhotoUrl);
      } catch (uploadError) {
        return res.status(400).render('edit-profile', {
          recruiter: recruiter,
          title: `Edit Profile | PreCheckd`,
          error: uploadError.message
        });
      }
    }

    await recruiter.save();

    res.redirect(`/recruiter/${recruiter.slug}`);

  } catch (err) {
    console.error('Edit profile save error:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;