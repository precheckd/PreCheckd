const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const ConnectionRequest = require('../models/ConnectionRequest');
const { getAnonymizedCandidateView } = require('../utils/candidateAnonymization');
const { candidateMeetsMatchingRequirements } = require('../utils/candidateMatchingRequirements');
const { DAY_CODES, DAY_OPTIONS, candidateAvailabilityGroup } = require('../utils/availabilityMatching');

const FULL_TIME_ANNUAL_HOURS = 2080; // 40 hrs/week * 52 weeks — same assumption used on the candidate side

function toAnnualEquivalent(amount, type) {
  return type === 'hourly' ? amount * FULL_TIME_ANNUAL_HOURS : amount;
}

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
// openToOpportunities, identity-verified, AND having filled in every
// required matching field (see utils/candidateMatchingRequirements.js —
// currently work areas + minimum salary). That last part is a hard
// requirement, not "unset means no filter" — Kent's call, borrowed from
// how dating apps that ask real questions match better than ones that
// let you skate by blank.
//
// Two optional, recruiter-entered filters layer on top of that baseline:
//
// - A pinned job location (?lat=&lng=, set client-side via geocoding a
//   typed address): only candidates whose drawn work-area shape contains
//   the pin are returned. Recruiters don't get their own drawing tool —
//   a point is all a job needs, since it's the candidate's shape that
//   decides reach, not a recruiter-chosen radius.
// - A role budget (?budgetAmount=&budgetType=annual|hourly): only
//   candidates whose minimum salary is at or below that budget (both
//   normalized to an annual-equivalent) are returned. The budget number
//   itself is never stored or shown to the candidate.
// - A role's required days/hours (?availDays=mon,tue&availStart=&availEnd=):
//   unlike the two filters above, this doesn't simply exclude non-matches.
//   "Never set an availability preference" isn't the same as "confirmed
//   can't do these hours," so candidates split into two groups: those who
//   opted in and cover the required window (shown first), and those who
//   never set availability at all (shown below, clearly labeled so the
//   recruiter knows to just ask). Anyone who opted in but does NOT cover
//   the required window is excluded outright.
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

    const budgetAmountRaw = parseFloat(req.query.budgetAmount);
    const budgetType = req.query.budgetType === 'hourly' ? 'hourly' : 'annual';
    const hasBudget = Number.isFinite(budgetAmountRaw) && budgetAmountRaw > 0;
    const budgetAnnualEquivalent = hasBudget ? toAnnualEquivalent(budgetAmountRaw, budgetType) : null;

    let candidates = await Candidate.find(query).sort({ createdAt: -1 });

    // Required-matching-fields check runs in app code (not the Mongo
    // query) so this stays in sync with the one shared definition rather
    // than duplicating field-by-field logic here.
    candidates = candidates.filter(candidateMeetsMatchingRequirements);

    if (hasBudget) {
      candidates = candidates.filter((c) => c.minSalaryAnnualEquivalent <= budgetAnnualEquivalent);
    }

    const requiredDays = (req.query.availDays || '').split(',').filter((d) => DAY_CODES.includes(d));
    const availStart = req.query.availStart || '';
    const availEnd = req.query.availEnd || '';
    const hasAvailabilityFilter = requiredDays.length > 0 && Boolean(availStart) && Boolean(availEnd);

    let candidatesForView;
    let showAvailabilityGrouping = false;

    if (hasAvailabilityFilter) {
      const matched = [];
      const unset = [];

      candidates.forEach((c) => {
        const group = candidateAvailabilityGroup(c, requiredDays, availStart, availEnd);
        if (group === 'matched') matched.push(c);
        else if (group === 'unset') unset.push(c);
        // 'excluded' candidates are dropped entirely.
      });

      candidatesForView = matched.map((c) => getAnonymizedCandidateView(c))
        .concat(unset.map((c) => getAnonymizedCandidateView(c)));

      // Mark exactly the first candidate of the "unset" group so the view
      // knows where to drop in the divider, without the view needing to
      // re-derive group membership itself.
      if (matched.length > 0 && unset.length > 0) {
        candidatesForView[matched.length].showNoAvailabilityDivider = true;
      } else if (matched.length === 0 && unset.length > 0) {
        candidatesForView[0].showNoAvailabilityDivider = true;
      }

      showAvailabilityGrouping = true;
    } else {
      candidatesForView = candidates.map((c) => getAnonymizedCandidateView(c));
    }

    res.render('candidate-search', {
      candidates: candidatesForView,
      prefilledQuery: req.query.q || '',
      pinnedLat: hasPin ? lat : null,
      pinnedLng: hasPin ? lng : null,
      pinnedLabel: hasPin ? (req.query.label || '') : '',
      budgetAmount: hasBudget ? budgetAmountRaw : null,
      budgetType,
      dayOptions: DAY_OPTIONS,
      requiredDays,
      availStart,
      availEnd,
      showAvailabilityGrouping,
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

    if (!candidate || !candidateMeetsMatchingRequirements(candidate)) {
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

    if (!candidate || !candidateMeetsMatchingRequirements(candidate)) {
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
