// Demo site entry (only mounted when DEMO_MODE=true): a landing page with two one-click sign-ins to the shared
// sample accounts, so there are no passwords to hand out.
const express = require('express');
const demo = require('../config/demo');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');

const router = express.Router();

router.get('/', (req, res) => res.redirect('/demo'));

router.get('/demo', (req, res) => {
  res.render('demo-landing', {
    pageTitle: 'PreCheckd Demo',
    signupUrl: demo.signupUrl(), candidateSignupUrl: demo.candidateSignupUrl(),
    signedIn: Boolean(req.session.recruiterId || req.session.candidateId),
  });
});

router.post('/demo/recruiter', async (req, res) => {
  const recruiter = await Recruiter.findOne({ email: demo.RECRUITER_EMAIL });
  if (!recruiter) return res.status(503).send('The demo is resetting. Try again in a minute.');
  delete req.session.candidateId;
  req.session.recruiterId = recruiter._id.toString();
  res.redirect('/candidate-search');
});

router.post('/demo/candidate', async (req, res) => {
  const candidate = await Candidate.findOne({ email: demo.CANDIDATE_EMAIL });
  if (!candidate) return res.status(503).send('The demo is resetting. Try again in a minute.');
  delete req.session.recruiterId;
  req.session.candidateId = candidate._id.toString();
  res.redirect('/jobs');
});

module.exports = router;
