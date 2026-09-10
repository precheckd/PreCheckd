const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');

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

    // Render profile
    res.render('recruiter-profile', {
      recruiter: recruiter,
      title: `${recruiter.firstName} ${recruiter.lastName} - Verified Recruiter | PreCheckd`
    });

  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;