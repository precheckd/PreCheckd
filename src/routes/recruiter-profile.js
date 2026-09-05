const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');

// GET /recruiter/:slug (e.g. /recruiter/john-doe)
router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const parts = slug.split('-');
    
    if (parts.length < 2) {
      return res.status(404).render('404', { message: 'Recruiter not found' });
    }

    // Reconstruct name (e.g., "john-smith-jr" = John Smith Jr)
    const firstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const lastName = parts.slice(1).join('-').charAt(0).toUpperCase() + parts.slice(1).join('-').slice(1);

    // Query database
    const recruiter = await Recruiter.findOne({
      firstName: { $regex: `^${firstName}$`, $options: 'i' },
      lastName: { $regex: `^${lastName}$`, $options: 'i' },
      status: 'active'
    });

    if (!recruiter) {
      return res.status(404).render('404', { message: 'Recruiter not found' });
    }

    // Render profile
    res.render('recruiter-profile', {
      recruiter: recruiter,
      title: `${recruiter.firstName} ${recruiter.lastName} - Verified Recruiter | PreCheckd`
    });

  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).render('500', { message: 'Server error' });
  }
});

module.exports = router;