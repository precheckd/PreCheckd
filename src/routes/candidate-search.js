const express = require('express');
const skillsService = require('../services/skills');
const router = express.Router();
const SkillAssessment = require('../models/SkillAssessment');
const { parseRequirements, evaluate, compare, LEVELS, STALE_MS, parseTitleFilter, meetsTitle } = require('../utils/skillMatching');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const { notify } = require('../services/notifications');
const ConnectionRequest = require('../models/ConnectionRequest');
const { getAnonymizedCandidateView } = require('../utils/candidateAnonymization');
const { candidateMeetsMatchingRequirements } = require('../utils/candidateMatchingRequirements');
const { recordView } = require('../utils/viewTracker');
const { activeCerts } = require('../utils/certExpiry');
const { SHIFT_OPTIONS, SHIFT_CODES, candidateShiftGroup } = require('../utils/availabilityMatching');
const { CLEARANCE_OPTIONS, candidateClearanceGroup } = require('../utils/clearanceMatching');

const VALID_WORK_ARRANGEMENTS = ['remote', 'hybrid', 'in_office'];
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
// One form, one Search button: the recruiter sets whatever criteria they
// want and submits them all together (GET, so a search is a shareable URL).
// Every filter runs server-side. "Eligible" means openToOpportunities,
// identity-verified, AND having filled in every required matching field
// (see utils/candidateMatchingRequirements.js — currently work areas,
// minimum salary and work arrangement). That last part is a hard
// requirement, not "unset means no filter" — Kent's call, borrowed from
// how dating apps that ask real questions match better than ones that
// let you skate by blank.
//
// Submitting the form with nothing filled in is a valid search and returns
// every eligible candidate. Visiting the page with no query string at all
// shows the form and a prompt instead.
//
// Optional, recruiter-entered criteria layered on top of that baseline:
//
// - A keyword (?q=): every word must appear in the candidate's job titles,
//   certification names or anonymous id (case-insensitive).
// - A pinned job location (?lat=&lng=&label=, geocoded client-side from a
//   typed address on submit): only candidates whose drawn work-area shape
//   contains the pin are returned. Recruiters don't get their own drawing
//   tool — a point is all a job needs, since it's the candidate's shape
//   that decides reach, not a recruiter-chosen radius.
// - A role budget (?budgetAmount=&budgetType=annual|hourly): only
//   candidates whose minimum salary is at or below that budget (both
//   normalized to an annual-equivalent) are returned. The budget number
//   itself is never stored or shown to the candidate.
// - A role's work arrangement (?workArrangement=remote|hybrid|in_office):
//   work arrangement is a required, multi-select field on the candidate
//   side (see utils/candidateMatchingRequirements.js), so every eligible
//   candidate here has at least one value set — a candidate whose
//   selections don't include the one the recruiter is filtering for gets
//   excluded.
// - A role's shift (?shift=daytime|evenings|overnight|rotating) and minimum security
//   clearance (?clearance=public_trust|secret|top_secret|ts_sci): unlike the
//   filters above, these don't simply exclude non-matches. A candidate who
//   never chose shifts, or who hasn't chosen to show their clearance, isn't a
//   confirmed no, so candidates split into two groups: those confirmed to
//   match every one of these filters (shown first), and those with something
//   unknown (shown below, clearly labeled so the recruiter knows to just ask).
//   Anyone who chose to show a value that does NOT meet the filter is excluded.
router.get('/', async (req, res) => {
  try {
    const query = {
      openToOpportunities: true,
      isIdentityVerified: true
    };

    const keyword = (req.query.q || '').trim();
    const keywordTerms = keyword.toLowerCase().split(/\s+/).filter(Boolean);

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

    const workArrangement = VALID_WORK_ARRANGEMENTS.includes(req.query.workArrangement) ? req.query.workArrangement : null;
    if (workArrangement) {
      // workArrangement is an array field on the candidate — querying it
      // with a plain value matches any document whose array contains
      // that value (standard Mongo array-field equality semantics).
      query.workArrangement = workArrangement;
    }

    const budgetAmountRaw = parseFloat(req.query.budgetAmount);
    const budgetType = req.query.budgetType === 'hourly' ? 'hourly' : 'annual';
    const hasBudget = Number.isFinite(budgetAmountRaw) && budgetAmountRaw > 0;
    const budgetAnnualEquivalent = hasBudget ? toAnnualEquivalent(budgetAmountRaw, budgetType) : null;

    const requiredShift = SHIFT_CODES.includes(req.query.shift) && req.query.shift !== 'flexible' ? req.query.shift : '';
    const requiredClearance = CLEARANCE_OPTIONS.some((c) => c.code === req.query.clearance) ? req.query.clearance : '';
    const hasSoftFilter = Boolean(requiredShift || requiredClearance);

    // Any query string at all counts as a search — including the bare
    // ?searched=1 the form sends when nothing is filled in (show everyone).
    // Skills that have a test, for the filter dropdowns and to validate what was submitted.
    const skillOptions = [];
    for (const a of await SkillAssessment.find({ active: true, kind: { $ne: 'title' } })) {
      for (const sk of a.skills || []) if (!skillOptions.some((o) => o.key === sk.key)) skillOptions.push({ key: sk.key, label: sk.label });
    }
    skillOptions.sort((x, y) => x.label.localeCompare(y.label));
    const requirements = parseRequirements(req.query, new Set(skillOptions.map((o) => o.key)));
    if (requirements.length) query['skillSummary.key'] = { $in: requirements.map((r) => r.key) };
    const labelOf = new Map(skillOptions.map((o) => [o.key, o.label]));

    // Job-title tests a recruiter can filter on (exact score; only candidates who chose to show it).
    const titleOptions = (await SkillAssessment.find({ active: true, kind: 'title' }))
      .map((a) => ({ id: a.assessmentId, name: a.name })).sort((x, y) => (x.name || '').localeCompare(y.name || ''));
    const titleFilter = parseTitleFilter(req.query, new Set(titleOptions.map((o) => o.id)));
    if (titleFilter) query['titleSummary.assessmentId'] = titleFilter.assessmentId;

    const hasSearched = Object.keys(req.query).length > 0;

    let candidatesForView = [];

    if (hasSearched) {
      let candidates = await Candidate.find(query).sort({ createdAt: -1 });

      // Required-matching-fields check runs in app code (not the Mongo
      // query) so this stays in sync with the one shared definition rather
      // than duplicating field-by-field logic here.
      candidates = candidates.filter(candidateMeetsMatchingRequirements);

      if (hasBudget) {
        candidates = candidates.filter((c) => c.minSalaryAnnualEquivalent <= budgetAnnualEquivalent);
      }

      if (keywordTerms.length > 0) {
        candidates = candidates.filter((c) => {
          const searchable = [
            c.anonId,
            ...(c.workHistory || []).map((j) => j.jobTitle),
            ...activeCerts(c.certifications).map((cert) => cert.name)
          ].filter(Boolean).join(' ').toLowerCase();
          return keywordTerms.every((term) => searchable.includes(term));
        });
      }

      if (titleFilter) candidates = candidates.filter((c) => meetsTitle(c.titleSummary, titleFilter));

      const evalByAnon = new Map();
      if (requirements.length) {
        const evaluated = candidates.map((c) => ({ c, ev: evaluate(c.skillSummary, requirements) })).filter((x) => x.ev.any);
        evaluated.sort((x, y) => compare(x.ev, y.ev));
        evaluated.forEach((x) => evalByAnon.set(x.c.anonId, x.ev));
        candidates = evaluated.map((x) => x.c);
      }

      if (hasSoftFilter) {
        const matched = [];
        const unknown = [];
        candidates.forEach((c) => {
          const groups = [];
          if (requiredShift) groups.push(candidateShiftGroup(c, requiredShift));
          if (requiredClearance) groups.push(candidateClearanceGroup(c, requiredClearance));
          if (groups.includes('excluded')) return; // confirmed not a fit: dropped entirely
          (groups.includes('unset') ? unknown : matched).push(c);
        });

        if (requirements.length) {
          // Skill sections decide the order; these filters only drop confirmed non-fits.
          candidates = candidates.filter((c) => matched.includes(c) || unknown.includes(c));
          candidatesForView = candidates.map((c) => getAnonymizedCandidateView(c));
        } else {
          candidates = matched.concat(unknown);
          candidatesForView = candidates.map((c) => getAnonymizedCandidateView(c));
          // Mark exactly the first "unknown" candidate so the view knows where to drop the divider.
          if (unknown.length > 0) candidatesForView[matched.length].showUnknownDivider = true;
        }
      } else {
        candidatesForView = candidates.map((c) => getAnonymizedCandidateView(c));
      }

      // Skill chips on every card, and the per-requirement match detail when skills were searched.
      const docByAnon = new Map(candidates.map((c) => [c.anonId, c]));
      candidatesForView.forEach((v) => {
        const doc = docByAnon.get(v.anonId);
        const summary = (doc && doc.skillSummary) || [];
        v.skillChips = summary.map((s) => ({ label: s.label, level: s.level, stale: Date.now() - new Date(s.takenAt).getTime() > STALE_MS }));
        v.titleChips = ((doc && doc.titleSummary) || []).map((t) => ({
          name: t.name, score: t.score, right: t.right, total: t.total, stale: Date.now() - new Date(t.takenAt).getTime() > STALE_MS
        }));
        const ev = evalByAnon.get(v.anonId);
        if (ev) {
          v.skillSection = ev.full ? 'full' : 'partial';
          v.skillMatch = ev.per.map((p, i) => ({ label: labelOf.get(requirements[i].key), min: requirements[i].minLevel, status: p.status, level: p.level || null }));
        }
      });
    }

    res.render('candidate-search', {
      candidates: candidatesForView,
      hasSearched,
      keyword,
      pinnedLat: hasPin ? lat : null,
      pinnedLng: hasPin ? lng : null,
      pinnedLabel: hasPin ? (req.query.label || '') : '',
      budgetAmount: hasBudget ? budgetAmountRaw : null,
      budgetType,
      workArrangement,
      shiftOptions: SHIFT_OPTIONS,
      requiredShift,
      clearanceOptions: CLEARANCE_OPTIONS,
      requiredClearance,
      skillOptions,
      titleOptions,
      titleFilter,
      requirements,
      levels: LEVELS,
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

    // A recruiter looking at this candidate counts as one view this month.
    await recordView(req, 'candidate', candidate._id);

    res.render('candidate-search-profile', {
      candidate: getAnonymizedCandidateView(candidate),
      skillsView: await skillsService.recruiterView(candidate, { recruiterId: req.session.recruiterId }),
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

    // A candidate who ended a connection with this recruiter is not asked again.
    if (await require('../services/connectionEnd').endedByCandidate(candidate._id, req.session.recruiterId)) {
      return res.status(403).json({ error: 'You cannot send this person a request.' });
    }

    await ConnectionRequest.create({
      candidateId: candidate._id,
      recruiterId: req.session.recruiterId,
      note: trimmedNote,
      initiatedBy: 'recruiter'
    });
    {
      const rec = await Recruiter.findById(req.session.recruiterId).catch(() => null);
      notify('candidate', candidate._id, 'connect_request', `${rec ? rec.firstName + ' ' + rec.lastName : 'A recruiter'} wants to connect`, '/connections?tab=requests');
    }

    res.json({ success: true, alreadySent: false });
  } catch (error) {
    console.error('Error creating recruiter-initiated connection request:', error);
    res.status(500).json({ error: 'Failed to send connection request' });
  }
});

module.exports = router;
