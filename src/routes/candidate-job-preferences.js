const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const { getMissingMatchingRequirements } = require('../utils/candidateMatchingRequirements');
const { DAY_CODES, DAY_OPTIONS } = require('../utils/availabilityMatching');
const { EXPERIENCE_BANDS } = require('../utils/experienceLevel');

const VALID_WORK_ARRANGEMENTS = ['remote', 'hybrid', 'in_office', 'open_to_any'];
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
      dayOptions: DAY_OPTIONS,
      experienceBands: EXPERIENCE_BANDS
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
      openToOpportunities, workArrangement,
      minSalaryAmount, minSalaryType, preferredSalaryAmount, preferredSalaryType,
      availableStartTime, availableEndTime,
      securityClearance, securityClearanceOther, noticePeriod
    } = req.body;

    // Unchecked checkboxes aren't submitted at all, so absence means false.
    candidate.openToOpportunities = openToOpportunities === 'true';
    candidate.workArrangement = VALID_WORK_ARRANGEMENTS.includes(workArrangement) ? workArrangement : 'open_to_any';

    // Salary fields are optional here — a candidate can leave either blank
    // and come back later. Only search eligibility (a separate check) cares
    // whether minSalaryAmount is actually filled in.
    const parsedMinSalary = parseFloat(minSalaryAmount);
    candidate.minSalaryAmount = Number.isFinite(parsedMinSalary) && parsedMinSalary > 0 ? parsedMinSalary : null;
    candidate.minSalaryType = minSalaryType === 'hourly' ? 'hourly' : 'annual';

    const parsedPreferredSalary = parseFloat(preferredSalaryAmount);
    candidate.preferredSalaryAmount = Number.isFinite(parsedPreferredSalary) && parsedPreferredSalary > 0 ? parsedPreferredSalary : null;
    candidate.preferredSalaryType = preferredSalaryType === 'hourly' ? 'hourly' : 'annual';

    // Availability is all-or-nothing: it only means something as a
    // complete picture (which days + what window), so a partial submission
    // (e.g. days checked but a time field cleared) is treated as "opted
    // out" rather than stored half-filled.
    const submittedDaysRaw = req.body.availableDays;
    const submittedDays = !submittedDaysRaw
      ? []
      : (Array.isArray(submittedDaysRaw) ? submittedDaysRaw : [submittedDaysRaw])
          .filter((d) => DAY_CODES.includes(d));

    if (submittedDays.length > 0 && availableStartTime && availableEndTime) {
      candidate.availableDays = submittedDays;
      candidate.availableStartTime = availableStartTime;
      candidate.availableEndTime = availableEndTime;
    } else {
      candidate.availableDays = [];
      candidate.availableStartTime = null;
      candidate.availableEndTime = null;
    }

    candidate.securityClearance = VALID_SECURITY_CLEARANCES.includes(securityClearance) ? securityClearance : 'none';
    candidate.securityClearanceOther = candidate.securityClearance === 'other' && securityClearanceOther && securityClearanceOther.trim()
      ? securityClearanceOther.trim().slice(0, 100)
      : null;

    candidate.noticePeriod = VALID_NOTICE_PERIODS.includes(noticePeriod) ? noticePeriod : null;

    await candidate.save();

    res.redirect(`/candidate/${candidate.slug}/job-preferences`);
  } catch (error) {
    console.error('Error saving candidate job preferences:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
