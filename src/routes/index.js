const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { getTickerItems } = require('../services/siteStats');

router.get('/', async (req, res) => {
  // Real PreCheckd-wide totals, each hidden until it's big enough to help
  // (see services/siteStats.js). Empty list = no ticker.
  const tickerItems = await getTickerItems();
  res.render('home', { pageTitle: 'PreCheckd - Choose Your Path', tickerItems });
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
  res.render('founding-recruiter-landing', { pageTitle: 'PreCheckd - Recruiters' });
});

router.get('/recruiter-search', async (req, res) => {
  try {
    const recruiters = await Recruiter.find({ isActive: true, isSuspended: { $ne: true } }).sort({ createdAt: -1 });
    res.render('recruiter-search', { recruiters, prefilledQuery: req.query.q || '', pageTitle: 'PreCheckd - Browse Verified Recruiters' });
  } catch (error) {
    console.error('Error loading recruiter search page:', error);
    res.render('recruiter-search', { recruiters: [], prefilledQuery: '', pageTitle: 'PreCheckd - Browse Verified Recruiters' });
  }
});

router.get('/candidate-landing', (req, res) => {
  res.render('candidate-landing', { pageTitle: 'PreCheckd - For Job Seekers' });
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
            alreadyVerified: true,
            pageTitle: 'PreCheckd - Get Verified'
          });
        }
        return res.redirect(`/candidate/${candidate.slug}`);
      }
    }

    // A logged-in, unverified candidate arriving from the profile/banner
    // jumps straight to the identity step instead of the email gate.
    let verifyIdentityOnly = false;
    let verifyCandidateSlug = null;
    if (req.query.verify === 'identity' && req.session.candidateId) {
      const loggedIn = await Candidate.findById(req.session.candidateId);
      if (loggedIn && !loggedIn.isIdentityVerified) {
        verifyIdentityOnly = true;
        verifyCandidateSlug = loggedIn.slug;
      }
    }

    res.render('candidate-signup', {
      recruiter: recruiter,
      alreadyVerified: false,
      verifyIdentityOnly,
      verifyCandidateSlug,
      pageTitle: 'PreCheckd - Get Verified'
    });
  } catch (error) {
    console.error('Error loading candidate signup page:', error);
    res.render('candidate-signup', { recruiter: null, alreadyVerified: false, pageTitle: 'PreCheckd - Get Verified' });
  }
});

router.get('/login', (req, res) => {
  res.render('login', { pageTitle: 'PreCheckd - Members Login' });
});

router.get('/terms', (req, res) => {
  res.render('terms', { pageTitle: 'PreCheckd - Terms of Service' });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', { pageTitle: 'PreCheckd - Privacy Policy' });
});

module.exports = router;