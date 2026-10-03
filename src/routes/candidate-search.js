const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const ConnectionRequest = require('../models/ConnectionRequest');
const { getAnonymizedCandidateView } = require('../utils/candidateAnonymization');

function requireRecruiterLogin(req, res, next) {
  if (!req.session.recruiterId) {
    return res.redirect('/login');
  }
  next();
}

router.use(requireRecruiterLogin);

// GET /candidate-search — the recruiter-side mirror of /recruiter-search.
// Same client-side substring-filter pattern for role/cert text search:
// render every eligible candidate server-side with a data-search
// attribute, let the browser do the filtering. "Eligible" means
// openToOpportunities and at least identity-verified — no point surfacing
// a half-signed-up profile.
//
// A pinned job location (?lat=&lng=, set client-side via geocoding a
// typed address) is a separate, server-side filter on top of that: only
// candidates whose drawn work-area shape contains the pin are returned.
// Recruiters don't get their own drawing tool — a point is all a job
// needs, since it's the candidate's shape that decides reach, not a
// recruiter-chosen radius. Candidates with no drawn shape are excluded
// once a pin is set, since "no shape" means "anywhere" is unverifiable.
router.get('/', async (req, res) => {
  try {
    const query = {
      openToOpportunities: true,
      isIdentityVerified: true
    };

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const hasPin = Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

    if (hasPin) {
      query.workAreas = {
        $geoIntersects: {
          $geometry: { type: 'Point', coordinates: [lng, lat] }
        }
      };
    }

    const candidates = await Candidate.find(query).sort({ createdAt: -1 });

    const candidatesForView = candidates.map((c) => getAnonymizedCandidateView(c));

    res.render('candidate-search', {
      candidates: candidatesForView,
      prefilledQuery: req.query.q || '',
      pinnedLat: hasPin ? lat : null,
      pinnedLng: hasPin ? lng : null,
      pinnedLabel: hasPin ? (req.query.label || '') : '',
      title: 'Find Candidates | PreCheckd'
    });
  } catch (error) {
    console.error('Error loading candidate search:', error);
    res.status(500).send('Server error');
  }
});

// GET /candidate-search/:anonId — anonymized preview + "Request to
// Connect" form. Uses anonId rather than the Mongo _id in the URL so a
// recruiter can't probe for real candidate ids pre-connection.
router.get('/:anonId', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({
      anonId: req.params.anonId.toUpperCase(),
      openToOpportunities: true,
      isIdentityVerified: true
    });

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    const existingRequest = await ConnectionRequest.findOne({
      candidateId: candidate._id,
      recruiterId: req.session.recruiterId
    }).sort({ createdAt: -1 });

    res.render('candidate-search-profile', {
      candidate: getAnonymizedCandidateView(candidate),
      existingRequest: existingRequest ? { status: existingRequest.status } : null,
      title: `Candidate ${candidate.anonId} | PreCheckd`
    });
  } catch (error) {
    console.error('Error loading candidate search profile:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate-search/:anonId/connect — recruiter-initiated connection
// request. A note is required here (unlike the candidate-initiated side) —
// Kent wants recruiters to name what role/context they're reaching out
// about rather than stockpiling candidates with no real opening in mind.
router.post('/:anonId/connect', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({
      anonId: req.params.anonId.toUpperCase(),
      openToOpportunities: true,
      isIdentityVerified: true
    });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }

    const { note } = req.body;
    const trimmedNote = note && note.trim() ? note.trim().slice(0, 500) : null;

    if (!trimmedNote) {
      return res.status(400).json({ error: 'Please include a note on the role or context you\'re reaching out about.' });
    }

    const existingRequest = await ConnectionRequest.findOne({
      candidateId: candidate._id,
      recruiterId: req.session.recruiterId,
      status: { $in: ['pending', 'accepted'] }
    });

    if (existingRequest) {
      return res.json({ success: true, alreadySent: true });
    }

    await ConnectionRequest.create({
      candidateId: candidate._id,
      recruiterId: req.session.recruiterId,
      note: trimmedNote,
      initiatedBy: 'recruiter'
    });

    res.json({ success: true, alreadySent: false });
  } catch (error) {
    console.error('Error creating recruiter-initiated connection request:', error);
    res.status(500).json({ error: 'Failed to send connection request' });
  }
});

module.exports = router;
