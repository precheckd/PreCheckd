const express = require('express');
const router = express.Router();
const publicCheck = require('../services/publicCheck');

const BASE = () => (process.env.PUBLIC_BASE_URL || 'https://precheckd.com').replace(/\/$/, '');

// GET /is-this-recruiter-real — open to everyone, and meant to be found by search.
router.get('/is-this-recruiter-real', (req, res) => {
  res.render('public-check', {
    pageTitle: 'Is This Recruiter Real? Check a Recruiter Email | PreCheckd',
    metaDescription: 'Got a job email from a recruiter you don\'t know? Check how old their email domain is, see whether they are verified on PreCheckd, and learn the signs of a fake recruiter.',
    canonicalUrl: BASE() + '/is-this-recruiter-real',
  });
});

// POST /api/public-check — no account needed, so it is limited (see services/publicCheck.js).
router.post('/api/public-check', async (req, res) => {
  const parsed = publicCheck.parseEmail(req.body && req.body.email);
  if (!parsed) return res.status(400).json({ error: 'Please enter a full email address, like name@company.com.' });

  const blocked = publicCheck.allow(req.ip);
  if (blocked === 'slow-down') return res.status(429).json({ error: 'That is a lot of checks in a short time. Please try again in an hour, or sign up free to keep checking.' });
  if (blocked === 'busy') return res.status(429).json({ error: 'The checker is very busy today. Please try again tomorrow.' });

  try {
    res.json(await publicCheck.run(parsed.email, parsed.domain));
  } catch (error) {
    console.error('Public check failed:', error);
    res.status(500).json({ error: 'Something went wrong running this check. Please try again.' });
  }
});

module.exports = router;
