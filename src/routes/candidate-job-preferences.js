const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const { getMissingMatchingRequirements } = require('../utils/candidateMatchingRequirements');
const { SHIFT_OPTIONS, SHIFT_CODES } = require('../utils/availabilityMatching');

const VALID_WORK_ARRANGEMENTS = ['remote', 'hybrid', 'in_office'];
const VALID_SECURITY_CLEARANCES = ['none', 'public_trust', 'secret', 'top_secret', 'ts_sci', 'other'];
const VALID_NOTICE_PERIODS = ['immediately_available', 'two_weeks', 'currently_employed_flexible'];

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

// Everything here governs how (or whether) a candidate shows up in
// recruiter search — split out from the general Edit Profile page (which
// is about identity/background) once this list grew past salary, work
// arrangement, and availability, with more of this kind of thing expected
// to join it over time.
//
// GET /candidate/:slug/job-preferences
router.get('/:slug/job-preferences', async (req, res) => {
  try {
    const candidate = await loadOwnedCandidate(req, res);
    if (!candidate) return;

    res.render('candidate-job-preferences', {
      candidate,
      title: `Job Preferences | PreCheckd`,
      error: null,
      missingRequirements: getMissingMatchingRequirements(candidate),
      shiftOptions: SHIFT_OPTIONS
    });
  } catch (error) {
    console.error('Error loading candidate job-preferences page:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate/:slug/job-preferences
router.post('/:slug/job-preferences', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });
    if (!candidate) return res.status(404).send('Candidate not found.');
    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).send('You do not have permission to edit this profile.');
    }

    const {
      openToOpportunities,
      minSalaryAmount, minSalaryType, preferredSalaryAmount, preferredSalaryType,
      availableFrom,
      securityClearance, securityClearanceOther, noticePeriod
    } = req.body;

    // Unchecked checkboxes aren't submitted at all, so absence means false.
    candidate.openToOpportunities = openToOpportunities === 'true';

    // workArrangement is a multi-select checkbox group — req.body.workArrangement
    // is a string (one box checked), an array (multiple checked), or absent
    // (none checked). No default fallback: leaving it blank is a real,
    // required-field-missing state, not "open to any" — see
    // utils/candidateMatchingRequirements.js.
    const submittedArrangementRaw = req.body.workArrangement;
    const submittedArrangement = !submittedArrangementRaw
      ? []
      : (Array.isArray(submittedArrangementRaw) ? submittedArrangementRaw : [submittedArrangementRaw])
          .filter((a) => VALID_WORK_ARRANGEMENTS.includes(a));
    candidate.workArrangement = submittedArrangement;

    // Salary fields are optional here — a candidate can leave either blank
    // and come back later. Only search eligibility (a separate check) cares
    // whether minSalaryAmount is actually filled in.
    const parsedMinSalary = parseFloat(minSalaryAmount);
    candidate.minSalaryAmount = Number.isFinite(parsedMinSalary) && parsedMinSalary > 0 ? parsedMinSalary : null;
    candidate.minSalaryType = minSalaryType === 'hourly' ? 'hourly' : 'annual';

    const parsedPreferredSalary = parseFloat(preferredSalaryAmount);
    candidate.preferredSalaryAmount = Number.isFinite(parsedPreferredSalary) && parsedPreferredSalary > 0 ? parsedPreferredSalary : null;
    candidate.preferredSalaryType = preferredSalaryType === 'hourly' ? 'hourly' : 'annual';

    // Shifts: a checkbox group, so absence means none ticked. Anything not on the fixed list is dropped.
    const submittedShiftsRaw = req.body.shifts;
    candidate.shifts = !submittedShiftsRaw
      ? []
      : [...new Set((Array.isArray(submittedShiftsRaw) ? submittedShiftsRaw : [submittedShiftsRaw])
          .filter((sh) => SHIFT_CODES.includes(sh)))];

    // Available-to-start is a calendar day, stored as UTC midnight so it reads back as the same day.
    // Blank or unreadable means "not set", which never blocks an application.
    const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(availableFrom || '').trim());
    const startDay = dayMatch ? new Date(`${dayMatch[0]}T00:00:00Z`) : null;
    candidate.availableFrom = startDay && !Number.isNaN(startDay.getTime()) ? startDay : null;

    candidate.securityClearance = VALID_SECURITY_CLEARANCES.includes(securityClearance) ? securityClearance : 'none';
    candidate.securityClearanceOther = candidate.securityClearance === 'other' && securityClearanceOther && securityClearanceOther.trim()
      ? securityClearanceOther.trim().slice(0, 100)
      : null;

    candidate.showClearanceInSearch = req.body.showClearanceInSearch === 'true';

    candidate.noticePeriod = VALID_NOTICE_PERIODS.includes(noticePeriod) ? noticePeriod : null;

    await candidate.save();

    res.redirect(`/candidate/${candidate.slug}/job-preferences`);
  } catch (error) {
    console.error('Error saving candidate job preferences:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
