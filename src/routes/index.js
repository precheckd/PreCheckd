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

// Candidate signup page
router.get('/candidate-signup', (req, res) => {
  res.render('candidate-signup');
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