const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');

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

// GET /candidate/:slug/work-areas — the map page for drawing the area(s)
// a candidate is willing to work.
router.get('/:slug/work-areas', async (req, res) => {
  try {
    const candidate = await loadOwnedCandidate(req, res);
    if (!candidate) return;

    res.render('candidate-work-areas', {
      candidate,
      existingWorkAreas: candidate.workAreas && candidate.workAreas.coordinates
        ? candidate.workAreas
        : null,
      title: `Work Areas | PreCheckd`
    });
  } catch (error) {
    console.error('Error loading candidate work-areas page:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate/:slug/work-areas — save the drawn shape(s) as a GeoJSON
// MultiPolygon. Sending an empty shapes array clears workAreas entirely
// (candidate decided not to restrict where they'll work).
router.post('/:slug/work-areas', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).json({ error: 'You do not have permission to edit this profile.' });
    }

    const { coordinates } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
      candidate.workAreas = undefined;
      await candidate.save();
      return res.json({ success: true, cleared: true });
    }

    // Basic shape validation: a MultiPolygon is an array of Polygons, each
    // a non-empty array of linear rings, each ring a non-empty array of
    // [lng, lat] pairs. We don't validate closure/winding here — MongoDB's
    // 2dsphere index will reject genuinely malformed geometry on save.
    const isValidMultiPolygon = coordinates.every((polygon) =>
      Array.isArray(polygon) && polygon.length > 0 &&
      polygon.every((ring) =>
        Array.isArray(ring) && ring.length >= 4 &&
        ring.every((point) =>
          Array.isArray(point) && point.length === 2 &&
          typeof point[0] === 'number' && typeof point[1] === 'number'
        )
      )
    );

    if (!isValidMultiPolygon) {
      return res.status(400).json({ error: 'Invalid shape data.' });
    }

    candidate.workAreas = { type: 'MultiPolygon', coordinates };
    await candidate.save();

    res.json({ success: true, cleared: false });
  } catch (error) {
    console.error('Error saving candidate work areas:', error);
    res.status(400).json({ error: error.message || 'Failed to save work areas.' });
  }
});

module.exports = router;
