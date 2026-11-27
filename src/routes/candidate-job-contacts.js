// "Who can confirm your jobs": the candidate picks, per unverified job, how we may verify it and names a contact.
// Rules and wording live in services/jobContacts.js.
const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const jobContacts = require('../services/jobContacts');

router.use((req, res, next) => {
  if (!req.session.candidateId) return res.status(403).send('You must be logged in to view this page.');
  next();
});

async function loadOwnedCandidate(req, res) {
  const candidate = await Candidate.findOne({ slug: req.params.slug });
  if (!candidate) { res.status(404).send('Candidate not found.'); return null; }
  if (candidate._id.toString() !== req.session.candidateId) { res.status(403).send('You do not have permission to view this page.'); return null; }
  return candidate;
}

const show = (res, candidate, extra = {}) => res.render('candidate-job-contacts', {
  candidate, title: 'Who can confirm your jobs | PreCheckd', choices: jobContacts.CHOICES,
  fingerprint: jobContacts.fingerprint, error: null, saved: false, ...extra
});

// GET /candidate/:slug/job-contacts
router.get('/:slug/job-contacts', async (req, res) => {
  try {
    const candidate = await loadOwnedCandidate(req, res);
    if (!candidate) return;
    show(res, candidate, { saved: req.query.saved === '1' });
  } catch (error) {
    console.error('Error loading job contacts page:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate/:slug/job-contacts
router.post('/:slug/job-contacts', async (req, res) => {
  try {
    const candidate = await loadOwnedCandidate(req, res);
    if (!candidate) return;
    const result = jobContacts.apply(candidate, jobContacts.parseForm(req.body));
    if (result.error) return show(res.status(400), candidate, { error: result.error, posted: req.body });
    await candidate.save();
    res.redirect(`/candidate/${candidate.slug}/job-contacts?saved=1`);
  } catch (error) {
    console.error('Error saving job contacts:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
