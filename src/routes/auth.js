const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const { sendLoginEmail, generateVerificationToken } = require('../services/emailService');

// Request a magic login link
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const recruiter = await Recruiter.findOne({ email });

    // Always respond with success, whether or not the email matches a
    // recruiter — prevents leaking which emails are registered.
    if (recruiter) {
      const token = generateVerificationToken();
      recruiter.loginToken = token;
      recruiter.loginTokenExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
      await recruiter.save();

      sendLoginEmail(recruiter.email, recruiter.firstName, token).catch((emailError) => {
        console.error('Failed to send login email:', emailError);
      });
    }

    res.json({
      success: true,
      message: 'If that email is registered, a login link has been sent.'
    });
  } catch (error) {
    console.error('Error requesting login link:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Verify the magic login link and start a session
router.get('/login/verify', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send('Missing login token.');
    }

    const recruiter = await Recruiter.findOne({ loginToken: token });

    if (!recruiter) {
      return res.status(400).send('Invalid or already-used login link. Please request a new one.');
    }

    if (recruiter.loginTokenExpires && Date.now() > recruiter.loginTokenExpires) {
      return res.status(400).send('This login link has expired. Please request a new one.');
    }

    // Token is single-use — clear it immediately
    recruiter.loginToken = null;
    recruiter.loginTokenExpires = null;
    await recruiter.save();

    req.session.recruiterId = recruiter._id.toString();

    res.redirect(`/recruiter/${recruiter.slug}`);
  } catch (error) {
    console.error('Error verifying login link:', error);
    res.status(500).send('Something went wrong logging you in.');
  }
});

// Log out
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;