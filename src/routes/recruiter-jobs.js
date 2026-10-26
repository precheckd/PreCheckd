// Recruiter side of the Job Board: post a job, see your postings, record how one ended. (Public pages and applying
// come in later steps; see docs/job-board-spec.md.)
const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const JobPosting = require('../models/JobPosting');
const JobDraft = require('../models/JobDraft');
const MAX_DRAFTS = 10;
const SkillAssessment = require('../models/SkillAssessment');
const { validatePosting } = require('../services/postingValidation');
const { buildLocation } = require('../services/postingLocation');
const { recordMissingTitle } = require('../services/catalogRequests');
const { docFromValue, formFromPosting, changedParts } = require('../services/postingEdit');
const { titlesForSkills } = require('../content/jobTitles');
const { sweepPostingLater } = require('../services/jobMatches');
const { analyseEdit, applyImpact } = require('../services/postingImpact');
const JobApplication = require('../models/JobApplication');
const { ACTIVE, HAS_APPLIED, STAGE_LABEL, moveStage } = require('../services/jobApplications');
const { REJECTION_REASONS } = require('../content/rejectionReasons');
const { CATALOG } = require('../content/certCatalog');
const { US_STATES } = require('../utils/geo');
const { validateOutcome, recordOutcome, flagRepost } = require('../services/postingOutcome');
const { OUTCOME_KINDS, NOT_FILLED_REASONS, CANCEL_REASONS } = require('../content/outcomeReasons');
const ConnectionRequest = require('../models/ConnectionRequest');
const conversation = require('../utils/conversation');
const outreach = require('../services/outreach');
const { ensureMailAlias } = require('../utils/mailAlias');
const publicJob = require('../services/publicJob');
const { sendJobPostedEmail, sendJobEditedEmail, sendJobClosedEmail } = require('../services/emailService');
const opt = require('../content/postingOptions');
const standard = require('../content/postingStandardLines');

function requireRecruiterLogin(req, res, next) {
  if (!req.session.recruiterId) {
    // Remember a posting page so the link in the confirmation email lands there after login.
    if (req.method === 'GET') {
      const path = req.originalUrl.split('?')[0];
      if (require('./auth').safeRecruiterJobPath(path)) req.session.recruiterReturnTo = path;
    }
    return res.redirect('/login');
  }
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
    states: US_STATES, limits: opt.LIMITS, standard, payBench: require('../content/payBenchmarks').clientTable(),
    isEdit: false, withdrawPrompt: 0, draftId: '', startStep: 0, action: '/recruiter-jobs/new', backHref: '/recruiter-jobs', heading: 'Post a job', submitLabel: 'Post this job',
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
    // Active applicants per posting (still in play), for the Applicants column.
    const { ACTIVE } = require('../services/jobApplications');
    const apps = await JobApplication.find({ jobId: { $in: postings.map((p) => p._id) }, status: { $in: ACTIVE } });
    const applicantCounts = {};
    for (const a of apps) { const k = String(a.jobId); applicantCounts[k] = (applicantCounts[k] || 0) + 1; }
    const drafts = await JobDraft.find({ recruiterId: recruiter._id }).sort({ updatedAt: -1 });
    res.render('recruiter-jobs', { title: 'My Job Postings | PreCheckd', postings, applicantCounts, drafts, justPosted: req.query.posted === '1',
      digestOn: recruiter.applicantDigestOptOut !== true, digestSaved: req.query.digest === '1' });
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
    let draft = null;
    if (req.query.draft && /^[a-f0-9]{24}$/i.test(String(req.query.draft))) {
      draft = await JobDraft.findOne({ _id: req.query.draft, recruiterId: recruiter._id });
    }
    const form = draft ? draft.form || {} : {};
    const pickedKeys = formList(form.skills).map((x) => x && x.key).filter(Boolean);
    res.render('recruiter-job-form', formLocals({
      errors: {}, form, skillChoices: await skillOptions(),
      titleChoices: pickedKeys.length ? titlesForSkills(pickedKeys).map((t) => ({ id: t.id, title: t.title })) : [],
      draftId: draft ? String(draft._id) : '', startStep: draft ? draft.step || 0 : 0,
    }));
  } catch (error) {
    console.error('Error loading job form:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/draft — save the form as typed so far (called when the recruiter moves to another page)
router.post('/draft', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    const { _draftId, _step, ...form } = req.body || {};
    const picked = formList(form.skills).map((x) => x && x.key).filter(Boolean);
    if (!picked.length && !String(form.hiringCompany || '').trim()) return res.json({ ok: true, id: null });
    const step = Math.max(0, Math.min(20, parseInt(_step, 10) || 0));
    const label = String(form.nickname || form.hiringCompany || (form.titleId ? String(form.titleId).replace(/-/g, ' ') : '') || 'Untitled').slice(0, 80);
    let draft = null;
    if (_draftId && /^[a-f0-9]{24}$/i.test(String(_draftId))) draft = await JobDraft.findOne({ _id: _draftId, recruiterId: recruiter._id });
    if (draft) {
      draft.form = form; draft.step = step; draft.label = label; draft.updatedAt = new Date();
      draft.markModified('form');
      await draft.save();
    } else {
      if ((await JobDraft.countDocuments({ recruiterId: recruiter._id })) >= MAX_DRAFTS) {
        return res.status(409).json({ ok: false, error: `You can keep up to ${MAX_DRAFTS} drafts. Delete one from My job postings first.` });
      }
      draft = await JobDraft.create({ recruiterId: recruiter._id, form, step, label });
    }
    res.json({ ok: true, id: String(draft._id) });
  } catch (error) {
    console.error('Error saving job draft:', error);
    res.status(500).json({ ok: false });
  }
});

// POST /recruiter-jobs/draft/:id/delete
router.post('/draft/:id/delete', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    if (/^[a-f0-9]{24}$/i.test(String(req.params.id))) await JobDraft.deleteOne({ _id: req.params.id, recruiterId: recruiter._id });
    res.redirect('/recruiter-jobs');
  } catch (error) {
    console.error('Error deleting draft:', error);
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
        draftId: String(req.body._draftId || '').replace(/[^a-f0-9]/gi, '').slice(0, 24),
      }));
    }

    const posting = await JobPosting.create({ recruiterId: recruiter._id, source: 'precheckd', ...docFromValue(value, location) });
    if (/^[a-f0-9]{24}$/i.test(String(req.body._draftId || ''))) {
      try { await JobDraft.deleteOne({ _id: req.body._draftId, recruiterId: recruiter._id }); } catch (e) { console.error('Draft cleanup failed:', e.message); }
    }
    sweepPostingLater(posting);
    try { await flagRepost(posting); } catch (e) { console.error('Repost check failed:', e.message); }
    sendJobPostedEmail(recruiter, posting, { publicUrl: `${publicJob.BASE_URL()}${publicJob.pathOf(posting)}` }).catch((e) => console.error('Job posted email failed:', e.message));
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

// Validates an edit and works out what it would do. Shared by the save and the pre-save count.
async function checkEdit(req, posting) {
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
  if (Object.keys(errors).length) return { errors, value, skillChoices };
  const next = docFromValue(value, location);
  const parts = changedParts(posting, next);
  let impact = { withdraw: [], keep: [] };
  if (parts.length) {
    const draft = new JobPosting({ ...posting.toObject(), ...next });
    draft.areaRule = location.areaRule || undefined;
    impact = await analyseEdit(posting.toGateShape(), draft.toGateShape());
  }
  return { errors, value, skillChoices, location, next, parts, impact };
}

const confirmed = (v) => v === 'on' || v === 'true' || v === '1';

// POST /recruiter-jobs/:id/edit/preview — how many applicants an edit would withdraw or notify (the pop-up)
router.post('/:id/edit/preview', async (req, res) => {
  try {
    const recruiter = await loadPostingRecruiter(req, res);
    if (!recruiter) return;
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    if (posting.status !== 'open') return res.status(409).json({ ok: false });
    const r = await checkEdit(req, posting);
    if (Object.keys(r.errors).length) return res.json({ ok: false });
    res.json({ ok: true, withdraw: r.impact.withdraw.length, notify: r.impact.keep.length });
  } catch (error) {
    console.error('Error previewing posting edit:', error);
    res.status(500).json({ ok: false });
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

    const r = await checkEdit(req, posting);
    const titleChoices = () => titlesForSkills((r.value.skills || []).map((x) => x.key)).map((t) => ({ id: t.id, title: t.title }));
    if (Object.keys(r.errors).length) {
      return res.status(400).render('recruiter-job-form', editLocals(posting, { errors: r.errors, form: req.body, skillChoices: r.skillChoices, titleChoices: titleChoices() }));
    }

    if (!r.parts.length) return res.redirect(`/recruiter-jobs/${posting._id}?saved=nochange`);

    // Withdrawing people is never silent: the recruiter confirms the count first.
    if (r.impact.withdraw.length && !confirmed(req.body.confirmWithdraw)) {
      return res.status(409).render('recruiter-job-form', editLocals(posting, {
        errors: {}, form: req.body, skillChoices: r.skillChoices, titleChoices: titleChoices(), withdrawPrompt: r.impact.withdraw.length,
      }));
    }

    posting.set(r.next);
    if (!r.location.areaRule) posting.areaRule = undefined;
    posting.editedAt = new Date();
    posting.edits = [...posting.edits, { at: posting.editedAt, parts: r.parts }].slice(-30);
    await posting.save();
    await applyImpact(posting, r.impact, r.parts);
    sweepPostingLater(posting);
    sendJobEditedEmail(recruiter, posting, { parts: r.parts, withdrawn: r.impact.withdraw.length, notified: r.impact.keep.length })
      .catch((e) => console.error('Job edited email failed:', e.message));
    const extra = r.impact.withdraw.length ? `&withdrawn=${r.impact.withdraw.length}` : '';
    res.redirect(`/recruiter-jobs/${posting._id}?saved=1${extra}`);
  } catch (error) {
    console.error('Error saving posting edit:', error);
    res.status(500).send('Server error');
  }
});

// GET /recruiter-jobs/:id/applicants — who has applied (their full profile opens through the connection)
router.get('/:id/applicants', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    const apps = await JobApplication.find({ jobId: posting._id, status: { $in: HAS_APPLIED } }).populate('candidateId');
    res.render('recruiter-job-applicants', {
      title: `Applicants | ${posting.title} | PreCheckd`, posting,
      applicants: apps.filter((a) => a.candidateId).sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt)),
      stages: STAGE_LABEL, reasons: REJECTION_REASONS, live: ACTIVE, error: req.query.error || '', moved: req.query.moved || '',
    });
  } catch (error) {
    console.error('Error loading applicants:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/:id/applicants/:appId/stage — move an applicant along the pipeline
router.post('/:id/applicants/:appId/stage', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    const app = await JobApplication.findById(req.params.appId);
    if (!app || String(app.jobId) !== String(posting._id)) return res.status(404).send('Not found');
    const r = await moveStage(app, posting, String(req.body.stage || ''), { reason: req.body.reason });
    const back = `/recruiter-jobs/${posting._id}/applicants`;
    res.redirect(r.ok ? `${back}?moved=1` : `${back}?error=${encodeURIComponent(r.error)}`);
  } catch (error) {
    console.error('Error moving applicant:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/digest — turn the daily "new applicants" email on or off
router.post('/digest', async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.session.recruiterId);
    if (!recruiter) return res.redirect('/login');
    recruiter.applicantDigestOptOut = req.body.digest !== 'on';
    await recruiter.save();
    res.redirect('/recruiter-jobs?digest=1');
  } catch (error) {
    console.error('Error saving digest setting:', error);
    res.status(500).send('Server error');
  }
});

// GET /recruiter-jobs/:id — your own view of a posting (shows the private address)
router.get('/:id', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    res.render('recruiter-job-detail', {
      title: `${posting.title} | PreCheckd`, posting, standard, justPosted: req.query.posted === '1', outcomeDone: req.query.outcome === '1', saved: req.query.saved || '', withdrawn: parseInt(req.query.withdrawn, 10) || 0,
      applicantCount: await JobApplication.countDocuments({ jobId: posting._id, status: { $in: ACTIVE } }),
      shareUrl: `${publicJob.BASE_URL()}${publicJob.pathOf(posting)}`, sent: req.query.sent || '', sendError: req.query.sendError || '', emailed: req.query.emailed || '', emailError: req.query.emailError || '',
      shareable: posting.status === 'open'
        ? (await ConnectionRequest.find({ recruiterId: req.session.recruiterId, status: 'accepted' }).populate('candidateId')).filter((c) => c.candidateId)
        : [],
      options: { arrangements: opt.ARRANGEMENTS, employmentTypes: opt.EMPLOYMENT_TYPES, travel: opt.TRAVEL, shifts: opt.SHIFT_OPTIONS,
        payBasis: opt.PAY_BASIS, benefits: opt.BENEFITS, education: opt.EDUCATION_LEVELS, clearance: opt.CLEARANCE_OPTIONS },
    });
  } catch (error) {
    console.error('Error loading posting:', error);
    res.status(500).send('Server error');
  }
});

// The outcome form: how did this job end? Used when the close date passes (the gate sends you here and nothing else
// works until it is done) and for ending a posting early.
async function outcomeLocals(posting, extra) {
  const live = await JobApplication.find({ jobId: posting._id, status: { $in: ACTIVE } }).populate('candidateId');
  return {
    title: `How did ${posting.title} end? | PreCheckd`, posting, kinds: OUTCOME_KINDS, notFilledReasons: NOT_FILLED_REASONS, cancelReasons: CANCEL_REASONS,
    applicants: live.filter((a) => a.candidateId), overdue: posting.status === 'awaiting_outcome', errors: {}, form: {}, ...extra,
  };
}

router.get('/:id/outcome', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    if (!['open', 'awaiting_outcome'].includes(posting.status)) return res.redirect(`/recruiter-jobs/${posting._id}`);
    res.render('recruiter-job-outcome', await outcomeLocals(posting));
  } catch (error) {
    console.error('Error loading outcome form:', error);
    res.status(500).send('Server error');
  }
});

router.post('/:id/outcome', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    if (!['open', 'awaiting_outcome'].includes(posting.status)) return res.redirect(`/recruiter-jobs/${posting._id}`);
    const live = await JobApplication.find({ jobId: posting._id, status: { $in: ACTIVE } });
    const { errors, value } = validateOutcome(req.body, { posting, liveIds: live.map((a) => String(a._id)) });
    if (Object.keys(errors).length) {
      return res.status(400).render('recruiter-job-outcome', await outcomeLocals(posting, { errors, form: req.body }));
    }
    const result = await recordOutcome(posting, value);
    try {
      const recruiter = await Recruiter.findById(req.session.recruiterId);
      const label = (list, code) => ((list.find((x) => x.code === code) || {}).label) || null;
      const reasonList = value.kind === 'cancelled' ? CANCEL_REASONS : NOT_FILLED_REASONS;
      if (recruiter) {
        sendJobClosedEmail(recruiter, posting, {
          outcomeLabel: label(OUTCOME_KINDS, value.kind), reasonLabel: value.reason ? label(reasonList, value.reason) : null, reasonNote: value.reasonNote || '',
          applicants: await JobApplication.countDocuments({ jobId: posting._id }), hired: value.kind === 'hired_precheckd' ? result.hired : 0, closedOut: result.closedOut,
        }).catch((e) => console.error('Job closed email failed:', e.message));
      }
    } catch (e) { console.error('Job closed email failed:', e.message); }
    res.redirect(`/recruiter-jobs/${posting._id}?outcome=1`);
  } catch (error) {
    console.error('Error recording outcome:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/:id/send — send this job's public link to one of your connections as an ordinary message.
router.post('/:id/send', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    const back = `/recruiter-jobs/${posting._id}`;
    if (posting.status !== 'open') return res.redirect(`${back}?sendError=${encodeURIComponent('This job is closed.')}`);
    const ctx = await conversation.loadConversationContext({ type: 'recruiter', id: String(req.session.recruiterId) }, String(req.body.connectionId || ''));
    if (!ctx) return res.redirect(`${back}?sendError=${encodeURIComponent('Pick one of your connections.')}`);
    const url = `${publicJob.BASE_URL()}${publicJob.pathOf(posting)}`;
    const r = await conversation.sendThreadMessage(ctx, `I thought you might be interested in this job: ${posting.title} at ${posting.hiringCompany}. ${url}`);
    if (r.error) return res.redirect(`${back}?sendError=${encodeURIComponent(r.error)}`);
    res.redirect(`${back}?sent=1`);
  } catch (error) {
    console.error('Error sending job to a connection:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-jobs/:id/email — email this job's public link to someone who is not on PreCheckd yet. Uses the
// outreach rules (verified recruiters only, caps, one email per address per 30 days, do-not-contact list).
router.post('/:id/email', async (req, res) => {
  try {
    const posting = await loadOwnPosting(req, res);
    if (!posting) return;
    const back = `/recruiter-jobs/${posting._id}`;
    const fail = (msg) => res.redirect(`${back}?emailError=${encodeURIComponent(msg)}`);
    if (posting.status !== 'open') return fail('This job is closed.');
    const recruiter = await Recruiter.findById(req.session.recruiterId);
    if (!recruiter) return res.redirect('/login');
    let alias = null;
    try { alias = await ensureMailAlias('recruiter', recruiter); } catch (e) { alias = null; }
    const result = await outreach.sendOutreach({ recruiter, alias, input: {
      toEmail: String(req.body.toEmail || '').slice(0, 254), toName: String(req.body.toName || '').slice(0, 40),
      templateKey: 'job', role: posting.title, note: '', jobUrl: `${publicJob.BASE_URL()}${publicJob.pathOf(posting)}`,
    } });
    if (result.error) return fail(result.message || outreach.OUTREACH_ERRORS[result.error] || 'Something went wrong.');
    res.redirect(`${back}?emailed=1`);
  } catch (error) {
    console.error('Error emailing job:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
