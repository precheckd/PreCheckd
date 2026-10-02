const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');

router.get('/', (req, res) => {
  res.render('home');
});

// The nicer, newer recruiter-landing page (founding-recruiter-landing.ejs —
// built as a proper fragment on the shared main.css design system) used to
// only be reachable via one buried CTA on the recruiter profile page, while
// every actual "Recruiters" link site-wide (nav, footer, homepage) pointed
// at the older, hand-styled standalone page. Rendering it here instead
// means every existing link/bookmark to /recruiter-landing now gets the
// better page, with no URL or link text changes needed anywhere.
// recruiter-landing.ejs is left in place, unused, rather than deleted.
router.get('/recruiter-landing', (req, res) => {
  res.render('founding-recruiter-landing');
});

router.get('/recruiter-search', async (req, res) => {
  try {
    const recruiters = await Recruiter.find({ isActive: true, isSuspended: { $ne: true } }).sort({ createdAt: -1 });
    res.render('recruiter-search', { recruiters, prefilledQuery: req.query.q || '' });
  } catch (error) {
    console.error('Error loading recruiter search page:', error);
    res.render('recruiter-search', { recruiters: [], prefilledQuery: '' });
  }
});

router.get('/candidate-landing', (req, res) => {
  res.render('candidate-landing');
});

router.get('/candidate-signup', async (req, res) => {
  try {
    const recruiterSlug = req.query.recruiter;
    let recruiter = null;

    if (recruiterSlug) {
      recruiter = await Recruiter.findOne({ slug: recruiterSlug, isActive: true, isSuspended: { $ne: true } });
    }

    if (req.session.candidateId) {
      const candidate = await Candidate.findById(req.session.candidateId);

      if (candidate && candidate.isPhoneVerified && candidate.isIdentityVerified) {
        if (recruiter) {
          req.session.candidateRecruiterSlug = recruiterSlug;
          return res.render('candidate-signup', {
            recruiter,
            alreadyVerified: true
          });
        }
        return res.redirect(`/candidate/${candidate.slug}`);
      }
    }

    res.render('candidate-signup', {
      recruiter: recruiter,
      alreadyVerified: false
    });
  } catch (error) {
    console.error('Error loading candidate signup page:', error);
    res.render('candidate-signup', { recruiter: null, alreadyVerified: false });
  }
});

router.get('/login', (req, res) => {
  res.render('login');
});

router.get('/terms', (req, res) => {
  res.render('terms');
});

router.get('/privacy', (req, res) => {
  res.render('privacy');
});

module.exports = router;