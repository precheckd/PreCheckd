const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const { setupProgress, isOnboardingPending } = require('../utils/candidateOnboarding');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  next();
}

async function loadOwnedCandidate(req, res) {
  const candidate = await Candidate.findOne({ slug: req.params.slug });
  if (!candidate) {
    res.status(404).send('Candidate not found.');
    return null;
  }
  if (candidate._id.toString() !== req.session.candidateId) {
    res.status(403).send('You do not have permission to view this page.');
    return null;
  }
  return candidate;
}

// GET /candidate/:slug/setup — the guided setup checklist. Always reachable
// (finished candidates can come back to it); it only redirects new accounts
// here until the required steps are done.
router.get('/:slug/setup', requireCandidateLogin, async (req, res) => {
  try {
    const candidate = await loadOwnedCandidate(req, res);
    if (!candidate) return;

    const progress = setupProgress(candidate);
    // First time everything is done: stop the redirect.
    if (progress.complete && isOnboardingPending(candidate)) {
      candidate.onboarding.completedAt = new Date();
      await candidate.save();
    }

    res.render('candidate-setup', {
      candidate,
      progress,
      identityDone: Boolean(candidate.isIdentityVerified),
      title: 'Set up your profile | PreCheckd'
    });
  } catch (error) {
    console.error('Error loading candidate setup:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate/:slug/setup/sharing — confirm whether recruiters can find
// this candidate (the existing openToOpportunities switch).
router.post('/:slug/setup/sharing', requireCandidateLogin, async (req, res) => {
  try {
    const candidate = await loadOwnedCandidate(req, res);
    if (!candidate) return;

    candidate.openToOpportunities = req.body.openToOpportunities === 'on';
    if (!candidate.onboarding) candidate.onboarding = {};
    candidate.onboarding.sharingConfirmedAt = new Date();
    await candidate.save();

    res.redirect(`/candidate/${candidate.slug}/setup`);
  } catch (error) {
    console.error('Error saving setup sharing step:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
