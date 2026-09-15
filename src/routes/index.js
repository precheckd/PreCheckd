const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');

// Homepage
router.get('/', (req, res) => {
  res.render('home');
});

// Recruiter landing page
router.get('/recruiter-landing', (req, res) => {
  res.render('recruiter-landing');
});

// Recruiter search/browse page
router.get('/recruiter-search', (req, res) => {
  res.render('recruiter-search');
});

// Candidate landing page
router.get('/candidate-landing', (req, res) => {
  res.render('candidate-landing');
});

// Candidate signup / contact-a-recruiter entry point.
// Optional ?recruiter=<slug> carries context through the whole flow.
router.get('/candidate-signup', async (req, res) => {
  try {
    const recruiterSlug = req.query.recruiter;
    let recruiter = null;

    if (recruiterSlug) {
      recruiter = await Recruiter.findOne({ slug: recruiterSlug, isActive: true });
    }

    res.render('candidate-signup', {
      recruiter: recruiter
    });
  } catch (error) {
    console.error('Error loading candidate signup page:', error);
    res.render('candidate-signup', { recruiter: null });
  }
});

// Login page
router.get('/login', (req, res) => {
  res.render('login');
});

// Terms of Service
router.get('/terms', (req, res) => {
  res.render('terms');
});

// Privacy Policy
router.get('/privacy', (req, res) => {
  res.render('privacy');
});

// Candidate profile page
router.get('/candidate/:name', (req, res) => {
  res.render('candidate-profile');
});

module.exports = router;