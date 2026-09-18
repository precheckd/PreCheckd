const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');

const INTERNAL_ADMIN_SECRET = process.env.INTERNAL_ADMIN_SECRET;

function requireInternalAuth(req, res, next) {
  if (req.session.isInternalAdmin) {
    return next();
  }
  res.redirect('/internal/login');
}

// Login page
router.get('/login', (req, res) => {
  res.render('internal-login', { error: null });
});

router.post('/login', (req, res) => {
  const { secret } = req.body;

  if (!INTERNAL_ADMIN_SECRET) {
    return res.render('internal-login', { error: 'INTERNAL_ADMIN_SECRET is not configured on the server.' });
  }

  if (secret === INTERNAL_ADMIN_SECRET) {
    req.session.isInternalAdmin = true;
    return res.redirect('/internal/verify');
  }

  res.render('internal-login', { error: 'Incorrect password.' });
});

router.get('/logout', (req, res) => {
  req.session.isInternalAdmin = false;
  res.redirect('/internal/login');
});

router.use(requireInternalAuth);

// List all candidates who have at least one work/education/certification entry
router.get('/verify', async (req, res) => {
  try {
    const candidates = await Candidate.find({
      $or: [
        { 'workHistory.0': { $exists: true } },
        { 'educationHistory.0': { $exists: true } },
        { 'certifications.0': { $exists: true } }
      ]
    }).sort({ createdAt: -1 });

    res.render('internal-verify-list', { candidates });
  } catch (error) {
    console.error('Error loading internal verify list:', error);
    res.status(500).send('Server error');
  }
});

// Detail view for one candidate — shows every entry with a toggle
router.get('/verify/:candidateId', async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.candidateId);
    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }
    res.render('internal-verify-detail', { candidate });
  } catch (error) {
    console.error('Error loading candidate for internal verify:', error);
    res.status(500).send('Server error');
  }
});

// Toggle a single entry's verified status
router.post('/verify/:candidateId/toggle', async (req, res) => {
  try {
    const { category, index } = req.body;
    const candidate = await Candidate.findById(req.params.candidateId);

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    const validCategories = ['workHistory', 'educationHistory', 'certifications'];
    if (!validCategories.includes(category)) {
      return res.status(400).send('Invalid category.');
    }

    const entry = candidate[category][index];
    if (!entry) {
      return res.status(400).send('Entry not found at that index.');
    }

    entry.verified = !entry.verified;
    entry.verifiedAt = entry.verified ? new Date() : null;

    // Mongoose needs an explicit markModified call for in-place array
    // subdocument edits like this to actually persist correctly.
    candidate.markModified(category);
    await candidate.save();

    res.redirect(`/internal/verify/${candidate._id}`);
  } catch (error) {
    console.error('Error toggling verification status:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;