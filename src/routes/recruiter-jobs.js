// Recruiter side of the Job Board: post a job, see your postings, close one. (Public pages and applying
// come in later steps; see docs/job-board-spec.md.)
const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const JobPosting = require('../models/JobPosting');
const SkillAssessment = require('../models/SkillAssessment');
const { validatePosting } = require('../services/postingValidation');
const { buildLocation } = require('../services/postingLocation');
const { recordMissingTitle } = require('../services/catalogRequests');
const { docFromValue, formFromPosting, changedParts } = require('../services/postingEdit');
const { titlesForSkills } = require('../content/jobTitles');
const { CATALOG } = require('../content/certCatalog');
const { US_STATES } = require('../utils/geo');
const opt = require('../content/postingOptions');
const standard = require('../content/postingStandardLines');

function requireRecruiterLogin(req, res, next) {
  if (!req.session.recruiterId) return res.redirect('/login');
  next();
}
router.use(requireRecruiterLogin);

// Only a fully verified, active, unsuspended recruiter can post.
async function loadPostingRecruiter(req, res) {
  const recruiter = await Recruiter.findById(req.session.recruiterId);
  if (!recruiter) { res.redirect('/login'); return null; }
  const ok = recruiter.accountTier !== 'unverified_claim' && recruiter.isActive && recruiter.isIdentityVerified
    && recruiter.isPhoneVerified && !recruiter.isSuspended;
  if (!ok) {
    res.status(403).render('recruiter-jobs-locked', { title: 'Post a Job | PreCheckd' });
    return null;
  }
  return recruiter;
}

// Skills a posting can ask for: the ones we have a test for (same list recruiter search uses).
async function skillOptions() {
  const out = [];
  for (const a of await SkillAssessment.find({ active: true, kind: { $ne: 'title' } })) {
    for (const sk of a.skills || []) if (!out.some((o) => o.key === sk.key)) out.push({ key: sk.key, label: sk.label });
  }
  return out.sort((x, y) => x.label.localeCompare(y.label));
}

function formLocals(extra) {
  return {
    title: 'Post a Job | PreCheckd',
    arrangements: opt.ARRANGEMENTS, employmentTypes: opt.EMPLOYMENT_TYPES, travelOptions: opt.TRAVEL,
    shiftOptions: opt.SHIFT_OPTIONS.filter((s) => true), payBasisOptions: opt.PAY_BASIS, benefitOptions: opt.BENEFITS,
    minLevels: opt.MIN_LEVELS, educationLevels: opt.EDUCATION_LEVELS, clearanceOptions: opt.CLEARANCE_OPTIONS,
    certOptions: CATALOG.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    states: US_STATES, limits: opt.LIMITS, standard,
    isEdit: false, action: '/recruiter-jobs/new', backHref: '/recruiter-jobs', heading: 'Post a job', submitLabel: 'Post this job',
    ...extra,
  };
}

const formList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v]);

// GET /recruiter-jobs — my postings
router.get('/', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    const postings = await JobPosting.find({ recruiterId: recruiter._id }).sort({ createdAt: -1 });
    res.render('recruiter-jobs', { title: 'My Job Postings | PreCheckd', postings, justPosted: req.query.posted === '1' });
  } catch (error) {
    console.error('Error loading recruiter postings:', error);
    res.status(500).send('Server error');
  }
});

// GET /recruiter-jobs/titles?skills=linux,cloud — titles that cover every picked skill
router.get('/titles', async (req, res) => {
  const keys = String(req.query.skills || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, opt.LIMITS.maxSkills);
  res.json({ titles: titlesForSkills(keys).map((t) => ({ id: t.id, title: t.title })) });
});

// GET /recruiter-jobs/companies?q=acm — company names already used on postings
router.get('/companies', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ companies: [] });
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = await JobPosting.distinct('hiringCompany', { hiringCompany: new RegExp(escaped, 'i') });
    const seen = new Map();
    for (const n of names) { const k = n.toLowerCase().replace(/[^a-z0-9]/g, ''); if (!seen.has(k)) seen.set(k, n); }
    res.json({ companies: [...seen.values()].sort().slice(0, 8) });
  } catch (error) {
    res.json({ companies: [] });
  }
});

// POST /recruiter-jobs/request-title — no catalog title fits the skills; staff are told
router.post('/request-title', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    const labels = await skillOptions();
    const byKey = new Map(labels.map((o) => [o.key, o.label]));
    const names = formList(req.body.skills).map((s) => byKey.get(String((s && s.key) || s))).filter(Boolean).slice(0, opt.LIMITS.maxSkills);
    if (!names.length) return res.status(400).json({ error: 'Pick your skills first.' });
    await recordMissingTitle(recruiter._id, names);
    res.json({ ok: true, message: 'Thanks. We will add a title for these skills, usually within one business day, and you can finish your posting then.' });
  } catch (error) {
    console.error('Error recording title request:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// GET /recruiter-jobs/new
router.get('/new', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    res.render('recruiter-job-form', formLocals({ errors: {}, form: {}, skillChoices: await skillOptions(), titleChoices: [] }));
  } catch (error) {
    console.error('Error loading job form:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/new
router.post('/new', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    const skillChoices = await skillOptions();
    const skillLabels = new Map(skillChoices.map((o) => [o.key, o.label]));
    const { errors, value } = validatePosting(req.body, { skillLabels });

    let location = null;
    if (!Object.keys(errors).length) {
      try {
        location = await buildLocation(value);
      } catch (e) {
        if (e.code !== 'geocode_failed') throw e;
        errors.address = e.message;
      }
    }

    if (Object.keys(errors).length) {
      const pickedKeys = value.skills.map((s) => s.key);
      return res.status(400).render('recruiter-job-form', formLocals({
        errors, form: req.body, skillChoices, titleChoices: titlesForSkills(pickedKeys).map((t) => ({ id: t.id, title: t.title })),
      }));
    }

    const posting = await JobPosting.create({ recruiterId: recruiter._id, source: 'precheckd', ...docFromValue(value, location) });
    res.redirect(`/recruiter-jobs/${posting._id}?posted=1`);
  } catch (error) {
    console.error('Error creating job posting:', error);
    res.status(500).send('Server error');
  }
});

async function loadOwnPosting(req, res) {
  if (!/^[0-9a-f]{24}$/i.test(req.params.id)) { res.status(404).send('Posting not found.'); return null; }
  const posting = await JobPosting.findById(req.params.id);
  if (!posting || String(posting.recruiterId) !== String(req.session.recruiterId)) { res.status(404).send('Posting not found.'); return null; }
  return posting;
}

const editLocals = (posting, extra) => formLocals({
  isEdit: true, action: `/recruiter-jobs/${posting._id}/edit`, backHref: `/recruiter-jobs/${posting._id}`,
  heading: 'Edit job', submitLabel: 'Save changes', title: 'Edit Job | PreCheckd', ...extra,
});

// GET /recruiter-jobs/:id/edit — the posting's form, filled in
router.get('/:id/edit', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    if (posting.status !== 'open') return res.status(409).render('recruiter-jobs-locked', { title: 'Edit Job | PreCheckd', notEditable: true });
    const skillChoices = await skillOptions();
    res.render('recruiter-job-form', editLocals(posting, {
      errors: {}, form: formFromPosting(posting), skillChoices,
      titleChoices: titlesForSkills(posting.skills.map((s) => s.key)).map((t) => ({ id: t.id, title: t.title })),
    }));
  } catch (error) {
    console.error('Error loading edit form:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/:id/edit — same rules as posting; only an open posting can be edited
router.post('/:id/edit', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    if (posting.status !== 'open') return res.status(409).render('recruiter-jobs-locked', { title: 'Edit Job | PreCheckd', notEditable: true });

    const skillChoices = await skillOptions();
    const skillLabels = new Map(skillChoices.map((o) => [o.key, o.label]));
    const { errors, value } = validatePosting(req.body, { skillLabels, editing: { createdAt: posting.createdAt } });

    let location = null;
    if (!Object.keys(errors).length) {
      try {
        // The address is only looked up again if it changed; otherwise the saved point is reused.
        const point = posting.areaRule && posting.areaRule.point && posting.areaRule.point.length === 2 ? posting.areaRule.point : null;
        const sameAddress = point && value.address && value.address === posting.address;
        location = await buildLocation(value, sameAddress
          ? async () => ({ lng: point[0], lat: point[1], city: posting.displayCity, state: posting.displayState })
          : undefined);
      } catch (e) {
        if (e.code !== 'geocode_failed') throw e;
        errors.address = e.message;
      }
    }

    if (Object.keys(errors).length) {
      return res.status(400).render('recruiter-job-form', editLocals(posting, {
        errors, form: req.body, skillChoices,
        titleChoices: titlesForSkills(value.skills.map((s) => s.key)).map((t) => ({ id: t.id, title: t.title })),
      }));
    }

    const next = docFromValue(value, location);
    const parts = changedParts(posting, next);
    if (!parts.length) return res.redirect(`/recruiter-jobs/${posting._id}?saved=nochange`);
    posting.set(next);
    if (!location.areaRule) posting.areaRule = undefined;
    posting.editedAt = new Date();
    posting.edits = [...posting.edits, { at: posting.editedAt, parts }].slice(-30);
    await posting.save();
    res.redirect(`/recruiter-jobs/${posting._id}?saved=1`);
  } catch (error) {
    console.error('Error saving posting edit:', error);
    res.status(500).send('Server error');
  }
});

// GET /recruiter-jobs/:id — your own view of a posting (shows the private address)
router.get('/:id', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    res.render('recruiter-job-detail', {
      title: `${posting.title} | PreCheckd`, posting, standard, justPosted: req.query.posted === '1', saved: req.query.saved || '',
      options: { arrangements: opt.ARRANGEMENTS, employmentTypes: opt.EMPLOYMENT_TYPES, travel: opt.TRAVEL, shifts: opt.SHIFT_OPTIONS,
        payBasis: opt.PAY_BASIS, benefits: opt.BENEFITS, education: opt.EDUCATION_LEVELS, clearance: opt.CLEARANCE_OPTIONS },
    });
  } catch (error) {
    console.error('Error loading posting:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/:id/close — take a posting down early (the close-date outcome gate comes in a later step)
router.post('/:id/close', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    if (posting.status === 'open') {
      posting.status = 'closed';
      posting.closedAt = new Date();
      await posting.save();
    }
    res.redirect('/recruiter-jobs');
  } catch (error) {
    console.error('Error closing posting:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
