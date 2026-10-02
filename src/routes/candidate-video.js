const express = require('express');
const router = express.Router();
const multer = require('multer');
const Candidate = require('../models/Candidate');
const { uploadCandidateIntroVideo, uploadCandidateInterviewVideo, deleteS3Object } = require('../utils/s3Upload');
const { INTERVIEW_QUESTIONS } = require('../utils/interviewQuestions');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB, matches s3Upload.js video validation
});

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  next();
}

router.use(requireCandidateLogin);

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

// Lazily seed the 5 fixed interview-question slots the first time a
// candidate visits this page, without clobbering any already-recorded
// videos on repeat visits.
function ensureInterviewSlots(candidate) {
  const existingByQuestionId = new Map(
    (candidate.interviewVideos || []).map((v) => [v.questionId, v])
  );
  candidate.interviewVideos = INTERVIEW_QUESTIONS.map((q) => {
    const existing = existingByQuestionId.get(q.questionId);
    return existing || { questionId: q.questionId, question: q.prompt, videoUrl: null, recordedAt: null };
  });
}

// GET /candidate/:slug/videos — intro + 5 interview-question recorders.
// No scoring UI here — a rubric exists for later, this page only records.
router.get('/:slug/videos', async (req, res) => {
  try {
    const candidate = await loadOwnedCandidate(req, res);
    if (!candidate) return;

    ensureInterviewSlots(candidate);
    await candidate.save();

    res.render('candidate-videos', {
      candidate,
      title: `Video Introduction | PreCheckd`
    });
  } catch (error) {
    console.error('Error loading candidate video page:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate/:slug/videos/intro
router.post('/:slug/videos/intro', upload.single('video'), async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).json({ error: 'You do not have permission to edit this profile.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No video file provided.' });

    const oldUrl = candidate.introVideoUrl;
    const newUrl = await uploadCandidateIntroVideo(candidate._id.toString(), req.file);
    candidate.introVideoUrl = newUrl;
    await candidate.save();
    await deleteS3Object(oldUrl);

    res.json({ url: newUrl });
  } catch (error) {
    console.error('Error uploading candidate intro video:', error);
    res.status(400).json({ error: error.message || 'Failed to upload video.' });
  }
});

// POST /candidate/:slug/videos/interview/:questionId
router.post('/:slug/videos/interview/:questionId', upload.single('video'), async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).json({ error: 'You do not have permission to edit this profile.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No video file provided.' });

    const questionId = parseInt(req.params.questionId, 10);
    const questionDef = INTERVIEW_QUESTIONS.find((q) => q.questionId === questionId);
    if (!questionDef) return res.status(400).json({ error: 'Unknown interview question.' });

    ensureInterviewSlots(candidate);
    const slot = candidate.interviewVideos.find((v) => v.questionId === questionId);

    const oldUrl = slot.videoUrl;
    const newUrl = await uploadCandidateInterviewVideo(candidate._id.toString(), questionId, req.file);
    slot.videoUrl = newUrl;
    slot.recordedAt = new Date();
    await candidate.save();
    await deleteS3Object(oldUrl);

    res.json({ url: newUrl });
  } catch (error) {
    console.error('Error uploading candidate interview video:', error);
    res.status(400).json({ error: error.message || 'Failed to upload video.' });
  }
});

module.exports = router;
