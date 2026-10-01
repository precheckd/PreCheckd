const express = require('express');
const router = express.Router();
const SavedRecruiter = require('../models/SavedRecruiter');
const Recruiter = require('../models/Recruiter');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).json({ error: 'You must be logged in as a candidate to do this.' });
  }
  next();
}

router.use(requireCandidateLogin);

// GET /api/saved-recruiters/status/:slug — is this recruiter already saved
// by the current candidate? Powers the Save/Saved button's initial state.
router.get('/status/:slug', async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ slug: req.params.slug });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    const existing = await SavedRecruiter.findOne({
      candidateId: req.session.candidateId,
      recruiterId: recruiter._id
    });

    res.json({ saved: Boolean(existing), note: existing?.note || null });
  } catch (error) {
    console.error('Error checking saved-recruiter status:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/saved-recruiters/save — bookmark a recruiter, with an optional
// note captured at the moment of saving.
router.post('/save', async (req, res) => {
  try {
    const { recruiterSlug, note } = req.body;

    const recruiter = await Recruiter.findOne({ slug: recruiterSlug, isActive: true, isSuspended: { $ne: true } });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    const trimmedNote = note && note.trim() ? note.trim().slice(0, 500) : null;

    try {
      await SavedRecruiter.create({
        candidateId: req.session.candidateId,
        recruiterId: recruiter._id,
        note: trimmedNote
      });
    } catch (error) {
      // Duplicate key error just means it's already saved — update the
      // note on the existing record instead of failing, since the
      // candidate's intent (save this, with this note) is still valid.
      if (error.code === 11000) {
        await SavedRecruiter.updateOne(
          { candidateId: req.session.candidateId, recruiterId: recruiter._id },
          { note: trimmedNote }
        );
      } else {
        throw error;
      }
    }

    res.json({ success: true, saved: true });
  } catch (error) {
    console.error('Error saving recruiter:', error);
    res.status(500).json({ error: 'Something went wrong saving this recruiter.' });
  }
});

// POST /api/saved-recruiters/unsave — remove a bookmark
router.post('/unsave', async (req, res) => {
  try {
    const { recruiterSlug } = req.body;

    const recruiter = await Recruiter.findOne({ slug: recruiterSlug });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    await SavedRecruiter.deleteOne({
      candidateId: req.session.candidateId,
      recruiterId: recruiter._id
    });

    res.json({ success: true, saved: false });
  } catch (error) {
    console.error('Error unsaving recruiter:', error);
    res.status(500).json({ error: 'Something went wrong removing this recruiter.' });
  }
});

// GET /api/saved-recruiters/list — full list of the candidate's saved
// recruiters, with notes, for the "My Saved Recruiters" page.
router.get('/list', async (req, res) => {
  try {
    const saved = await SavedRecruiter.find({ candidateId: req.session.candidateId })
      .sort({ savedAt: -1 })
      .populate('recruiterId', 'firstName lastName company slug profilePhotoUrl');

    const results = saved
      .filter((s) => s.recruiterId)
      .map((s) => ({
        id: s._id,
        note: s.note,
        savedAt: s.savedAt,
        recruiter: {
          slug: s.recruiterId.slug,
          firstName: s.recruiterId.firstName,
          lastName: s.recruiterId.lastName,
          company: s.recruiterId.company && s.recruiterId.company !== 'Not provided' ? s.recruiterId.company : null,
          profilePhotoUrl: s.recruiterId.profilePhotoUrl
        }
      }));

    res.json({ savedRecruiters: results });
  } catch (error) {
    console.error('Error loading saved recruiters list:', error);
    res.status(500).json({ error: 'Something went wrong loading your saved recruiters.' });
  }
});

// POST /api/saved-recruiters/update-note — edit the note on an existing
// saved recruiter from the full list page.
router.post('/update-note', async (req, res) => {
  try {
    const { recruiterSlug, note } = req.body;

    const recruiter = await Recruiter.findOne({ slug: recruiterSlug });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    const trimmedNote = note && note.trim() ? note.trim().slice(0, 500) : null;

    const result = await SavedRecruiter.updateOne(
      { candidateId: req.session.candidateId, recruiterId: recruiter._id },
      { note: trimmedNote }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'This recruiter is not in your saved list.' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating saved-recruiter note:', error);
    res.status(500).json({ error: 'Something went wrong saving your note.' });
  }
});

module.exports = router;