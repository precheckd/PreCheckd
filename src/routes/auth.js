const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { sendPasswordResetEmail, generateVerificationToken } = require('../services/emailService');

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// --- Unified login: email + password, either account type ---
// Every email is tied to exactly one account sitewide (enforced at signup
// in candidate.js and founding-recruiter.js), so a single form can check
// Recruiter first, then Candidate, and log into whichever one matches —
// same lookup order /forgot-password already uses for the same reason.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const recruiter = await Recruiter.findOne({ email: normalizedEmail });
    const candidate = recruiter ? null : await Candidate.findOne({ email: normalizedEmail });
    const account = recruiter || candidate;

    if (!account || !account.passwordHash) {
      // Covers "no such account" and "account predates passwords" — in the
      // second case, nudge toward the one path that works (forgot-password
      // doubles as first-time set-password) rather than a dead-end
      // "incorrect password".
      if (account && !account.passwordHash) {
        return res.status(400).json({
          error: 'This account hasn\'t set a password yet. Use "Forgot password?" below to set one.'
        });
      }
      return res.status(400).json({ error: 'Incorrect email or password.' });
    }

    const matches = await bcrypt.compare(password, account.passwordHash);
    if (!matches) {
      return res.status(400).json({ error: 'Incorrect email or password.' });
    }

    if (recruiter) {
      if (recruiter.isSuspended) {
        return res.status(403).json({
          error: 'Your account has been suspended. Contact us directly for details.'
        });
      }

      delete req.session.candidateId;
      req.session.recruiterId = recruiter._id.toString();

      return res.json({
        success: true,
        accountType: 'recruiter',
        accountTier: recruiter.accountTier,
        slug: recruiter.slug
      });
    }

    delete req.session.recruiterId;
    req.session.candidateId = candidate._id.toString();

    res.json({
      success: true,
      accountType: 'candidate',
      slug: candidate.slug,
      isFullyVerified: Boolean(candidate.isPhoneVerified && candidate.isIdentityVerified)
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// --- Request a password reset / first-time set-password link ---
// Shared by recruiters and candidates — looks up both, since the login
// page doesn't ask which kind of account you have.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const recruiter = await Recruiter.findOne({ email: normalizedEmail });
    const candidate = recruiter ? null : await Candidate.findOne({ email: normalizedEmail });
    const account = recruiter || candidate;

    // Always respond with success whether or not the email matches —
    // prevents leaking which emails are registered.
    if (account) {
      const token = generateVerificationToken();
      account.loginToken = token;
      account.loginTokenExpires = Date.now() + RESET_TOKEN_TTL_MS;
      await account.save();

      sendPasswordResetEmail(account.email, account.firstName, token, {
        isFirstTime: !account.passwordHash
      }).catch((emailError) => {
        console.error('Failed to send password reset email:', emailError);
      });
    }

    res.json({
      success: true,
      message: 'If that email is registered, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// --- Reset-password page (shared recruiter/candidate) ---
router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const recruiter = await Recruiter.findOne({ loginToken: token });
    const candidate = recruiter ? null : await Candidate.findOne({ loginToken: token });
    const account = recruiter || candidate;

    if (!account) {
      return res.render('reset-password', {
        error: 'Invalid or already-used link. Please request a new one.',
        token: null,
        isFirstTime: false
      });
    }

    if (account.loginTokenExpires && Date.now() > account.loginTokenExpires) {
      return res.render('reset-password', {
        error: 'This link has expired. Please request a new one.',
        token: null,
        isFirstTime: false
      });
    }

    res.render('reset-password', {
      error: null,
      token,
      isFirstTime: !account.passwordHash
    });
  } catch (error) {
    console.error('Error loading reset-password page:', error);
    res.render('reset-password', { error: 'Something went wrong. Please try again.', token: null, isFirstTime: false });
  }
});

// --- Submit a new password ---
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const recruiter = await Recruiter.findOne({ loginToken: token });
    const candidate = recruiter ? null : await Candidate.findOne({ loginToken: token });
    const account = recruiter || candidate;

    if (!account) {
      return res.status(400).json({ error: 'Invalid or already-used link. Please request a new one.' });
    }

    if (account.loginTokenExpires && Date.now() > account.loginTokenExpires) {
      return res.status(400).json({ error: 'This link has expired. Please request a new one.' });
    }

    if (recruiter && recruiter.isSuspended) {
      return res.status(403).json({ error: 'Your account has been suspended. Contact us directly for details.' });
    }

    account.passwordHash = await bcrypt.hash(password, 10);
    account.loginToken = null;
    account.loginTokenExpires = null;
    await account.save();

    if (recruiter) {
      delete req.session.candidateId;
      req.session.recruiterId = recruiter._id.toString();
      return res.json({
        success: true,
        accountType: 'recruiter',
        accountTier: recruiter.accountTier,
        slug: recruiter.slug
      });
    }

    delete req.session.recruiterId;
    req.session.candidateId = candidate._id.toString();
    res.json({
      success: true,
      accountType: 'candidate',
      slug: candidate.slug,
      isFullyVerified: Boolean(candidate.isPhoneVerified && candidate.isIdentityVerified)
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Log out
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
