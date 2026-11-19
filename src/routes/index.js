const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { getTickerItems } = require('../services/siteStats');
const BASE = () => (process.env.PUBLIC_BASE_URL || 'https://precheckd.com').replace(/\/$/, '');
const canon = (p) => BASE() + p;

router.get('/', async (req, res) => {
  // Real PreCheckd-wide totals, each hidden until it's big enough to help
  // (see services/siteStats.js). Empty list = no ticker.
  const tickerItems = await getTickerItems();
  res.render('home', {
    pageTitle: 'PreCheckd - Verified Recruiters and Candidates',
    metaDescription: 'PreCheckd verifies recruiters and candidates before they talk. Job seekers see who is really contacting them; recruiters see tested skills instead of resume claims.',
    canonicalUrl: canon('/'),
    tickerItems
  });
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
  res.render('founding-recruiter-landing', {
    pageTitle: 'PreCheckd - Become a Verified Recruiter',
    metaDescription: 'Get verified once and stand out to candidates. Founding recruiters lock in a lower price and meet job seekers who have proven their skills.',
    canonicalUrl: canon('/recruiter-landing')
  });
});

router.get('/recruiter-search', async (req, res) => {
  try {
    const recruiters = await Recruiter.find({ isActive: true, isSuspended: { $ne: true } }).sort({ createdAt: -1 });
    res.render('recruiter-search', { recruiters, prefilledQuery: req.query.q || '', pageTitle: 'PreCheckd - Browse Verified Recruiters', metaDescription: 'Browse recruiters whose identity, phone, email and company have been checked, so you know who you are talking to before you share anything.', canonicalUrl: canon('/recruiter-search') });
  } catch (error) {
    console.error('Error loading recruiter search page:', error);
    res.render('recruiter-search', { recruiters: [], prefilledQuery: '', pageTitle: 'PreCheckd - Browse Verified Recruiters' });
  }
});

// Ask page: the live chat plus the question rows (text + optional video) from
// src/content/askAnswers.js. noindex until the remaining Synthesia clips are in.
router.get('/ask', (req, res) => {
  const answers = require('../content/askAnswers').getAnswers({ billingLive: process.env.BILLING_LIVE === 'true' });
  res.render('ask', { pageTitle: 'PreCheckd - Ask Us Anything', robotsMeta: 'noindex', answers });
});

router.get('/candidate-landing', (req, res) => {
  res.render('candidate-landing', { pageTitle: 'PreCheckd - For Job Seekers', metaDescription: 'Prove your skills with tests, get verified, and deal only with recruiters who are verified too. No more guessing who is real.', canonicalUrl: canon('/candidate-landing') });
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
      pageTitle: 'PreCheckd - Get Verified',
      metaDescription: 'Create your candidate profile, verify your identity and show recruiters what you can really do.',
      canonicalUrl: canon('/candidate-signup'),
      robotsMeta: recruiterSlug || verifyIdentityOnly ? 'noindex' : ''
    });
  } catch (error) {
    console.error('Error loading candidate signup page:', error);
    res.render('candidate-signup', { recruiter: null, alreadyVerified: false, pageTitle: 'PreCheckd - Get Verified' });
  }
});

router.get('/login', (req, res) => {
  res.render('login', { pageTitle: 'PreCheckd - Members Login', robotsMeta: 'noindex' });
});

router.get('/terms', (req, res) => {
  res.render('terms', { pageTitle: 'PreCheckd - Terms of Service', metaDescription: 'The terms for using PreCheckd as a recruiter or candidate.', canonicalUrl: canon('/terms') });
});

router.get('/skills-explained', (req, res) => {
  res.render('skills-explained', { pageTitle: 'PreCheckd - How Skill Levels Work', metaDescription: 'How PreCheckd skill tests work: Foundational to Grandmaster levels instead of percentages, how retakes work, and what recruiters see.', canonicalUrl: canon('/skills-explained') });
});

router.get('/founder', (req, res) => {
  res.render('founder', { pageTitle: 'PreCheckd - From the Founder', metaDescription: 'Why Kent Mayer built PreCheckd after finding hiring broken: fake recruiters, ignored applications, and resumes nobody can check.', canonicalUrl: canon('/founder') });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', { pageTitle: 'PreCheckd - Privacy Policy', metaDescription: 'What PreCheckd collects, what it keeps, and the choices you have.', canonicalUrl: canon('/privacy') });
});

module.exports = router;