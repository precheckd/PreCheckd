// Public job pages: anyone can read an open posting without logging in (see docs/job-board-spec.md, section 3).
// Never shows the street address or the recruiter's internal label. Applying comes in the next step.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const JobPosting = require('../models/JobPosting');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const JobApplication = require('../models/JobApplication');
const { ACTIVE, HAS_APPLIED, STAGE_LABEL, applyToJob, withdrawApplication } = require('../services/jobApplications');
const { notify } = require('../services/notifications');
const { evaluate } = require('../services/applyGate');
const { buildCandidateFacts } = require('../services/applyFacts');
const { classify } = require('../services/jobMatch');
const pub = require('../services/publicJob');
const opt = require('../content/postingOptions');
const standard = require('../content/postingStandardLines');

const helpers = { label: pub.label, money: pub.money, options: {
  arrangements: opt.ARRANGEMENTS, employmentTypes: opt.EMPLOYMENT_TYPES, travel: opt.TRAVEL, shifts: opt.SHIFT_OPTIONS,
  payBasis: opt.PAY_BASIS, benefits: opt.BENEFITS, education: opt.EDUCATION_LEVELS, clearance: opt.CLEARANCE_OPTIONS } };

// GET /jobs — every open posting, with a map of blurred circles
router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    const q = String(req.query.q || '').trim().slice(0, 100).toLowerCase();
    const arrangement = opt.ARRANGEMENTS.some((a) => a.code === req.query.arrangement) ? req.query.arrangement : '';
    const all = (await JobPosting.find({ status: 'open' }).sort({ createdAt: -1 })).filter((p) => pub.isOpenNow(p, now));
    const matches = (j) => (!arrangement || j.arrangement === arrangement)
      && (!q || [j.title, j.hiringCompany, j.location, ...j.skills.map((s) => s.label)].join(' ').toLowerCase().includes(q));
    let rows = all.map((p) => ({ p, j: pub.publicShape(p) })).filter((r) => matches(r.j));

    // A signed-in candidate sees the jobs they can apply to first; everyone else sees every open job.
    const candidate = req.session && req.session.candidateId && mongoose.isValidObjectId(req.session.candidateId)
      ? await Candidate.findById(req.session.candidateId) : null;
    let viewer = null;
    if (candidate) {
      const applied = new Set((await JobApplication.find({ candidateId: candidate._id, jobId: { $in: rows.map((r) => r.p._id) }, status: { $in: HAS_APPLIED } })).map((a) => String(a.jobId)));
      const fit = await classify(candidate, rows.map((r) => r.p), applied);
      rows.forEach((r) => { r.j.fit = fit.get(r.j.id); });
      const count = (st) => rows.filter((r) => r.j.fit.status === st).length;
      const counts = { fit: count('fit'), applied: count('applied'), blocked: count('blocked'), area: rows.filter((r) => r.j.fit.inArea).length, all: rows.length };
      let view = ['all', 'area'].includes(req.query.view) ? req.query.view : 'fit';
      const fallback = view === 'fit' && counts.fit + counts.applied === 0 && rows.length > 0;
      if (fallback) view = 'all';
      if (view === 'fit') rows = rows.filter((r) => r.j.fit.status !== 'blocked');
      else if (view === 'area') rows = rows.filter((r) => r.j.fit.inArea);
      if (view !== 'fit') rows.sort((a, b) => ({ fit: 0, applied: 1, blocked: 2 })[a.j.fit.status] - ({ fit: 0, applied: 1, blocked: 2 })[b.j.fit.status]);
      viewer = { view, counts, fallback };
    }
    const jobs = rows.map((r) => r.j);
    res.render('jobs-list', {
      pageTitle: 'Open jobs | PreCheckd',
      metaDescription: 'Jobs where every applicant has a verified identity, tested skills and verified credentials.',
      canonicalUrl: pub.BASE_URL() + '/jobs',
      jobs, q, arrangement, totalOpen: all.length, viewer, ...helpers,
    });
  } catch (error) {
    console.error('Error loading jobs:', error);
    res.status(500).send('Server error');
  }
});

// ---- sending a visitor to sign up or log in, and bringing them back to the job afterwards ----
// GET /jobs/:id/start?to=login|signup — remembers the job, then goes to the right page
router.get('/:id/start', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/jobs');
    const posting = await JobPosting.findById(req.params.id);
    if (!posting || posting.status === 'removed') return res.redirect('/jobs');
    if (req.session) req.session.returnTo = pub.pathOf(posting);
    res.redirect(req.query.to === 'login' ? '/login' : '/candidate-landing');
  } catch (error) {
    console.error('Error starting a job visit:', error);
    res.redirect('/jobs');
  }
});

// Everything the apply screens need, or null after answering the request itself.
async function loadForApply(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).render('error', { title: 'Not found', message: 'We could not find that job.' }); return null; }
  const posting = await JobPosting.findById(req.params.id);
  if (!posting || posting.status === 'removed') { res.status(404).render('error', { title: 'Not found', message: 'We could not find that job.' }); return null; }
  const back = pub.pathOf(posting);
  if (!req.session || !req.session.candidateId) {
    if (req.session) req.session.returnTo = back;
    res.redirect('/login'); return null;
  }
  const candidate = await Candidate.findById(req.session.candidateId);
  if (!candidate) { res.redirect('/login'); return null; }
  const existing = await JobApplication.findOne({ jobId: posting._id, candidateId: candidate._id });
  const alreadyApplied = Boolean(existing && HAS_APPLIED.includes(existing.status));
  const gate = evaluate(await buildCandidateFacts(candidate, { posting: posting.toGateShape(), alreadyApplied }), posting.toGateShape());
  return { posting, candidate, existing, gate, back };
}

// GET /jobs/:id/apply — the last screen before applying: says plainly what applying does
router.get('/:id/apply', async (req, res) => {
  try {
    const c = await loadForApply(req, res);
    if (!c) return;
    if (!c.gate.canApply) return res.redirect(c.back);
    const j = pub.publicShape(c.posting);
    const poster = await Recruiter.findById(c.posting.recruiterId);
    res.render('job-apply', { pageTitle: `Apply: ${j.title} | PreCheckd`, robotsMeta: 'noindex', j, back: c.back, postingId: String(c.posting._id),
      posterName: poster ? [poster.firstName, poster.lastName].filter(Boolean).join(' ') : 'the recruiter', ...helpers });
  } catch (error) {
    console.error('Error loading apply screen:', error);
    res.status(500).send('Server error');
  }
});

// POST /jobs/:id/apply
router.post('/:id/apply', async (req, res) => {
  try {
    const c = await loadForApply(req, res);
    if (!c) return;
    if (!c.gate.canApply) return res.redirect(c.back);
    await applyToJob(c.candidate, c.posting);
    res.redirect(`${c.back}?applied=1`);
  } catch (error) {
    console.error('Error applying:', error);
    res.status(500).send('Server error');
  }
});

// POST /jobs/:id/withdraw — the candidate takes their application back
router.post('/:id/withdraw', async (req, res) => {
  try {
    const c = await loadForApply(req, res);
    if (!c) return;
    if (c.existing && ACTIVE.includes(c.existing.status)) {
      await withdrawApplication(c.existing, { by: 'candidate' });
      await notify('recruiter', c.posting.recruiterId, 'job_withdrew', `An applicant withdrew from ${c.posting.title}`.slice(0, 200), `/recruiter-jobs/${c.posting._id}/applicants`);
    }
    res.redirect(`${c.back}?withdrew=1`);
  } catch (error) {
    console.error('Error withdrawing:', error);
    res.status(500).send('Server error');
  }
});

// GET /jobs/sitemap.xml — open postings, for search engines (submit once in Google Search Console)
router.get('/sitemap.xml', async (req, res) => {
  try {
    const now = Date.now();
    const open = (await JobPosting.find({ status: 'open' }).sort({ createdAt: -1 })).filter((p) => pub.isOpenNow(p, now));
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const urls = open.map((p) => `<url><loc>${esc(pub.BASE_URL() + pub.pathOf(p))}</loc><lastmod>${new Date(p.editedAt || p.createdAt).toISOString().slice(0, 10)}</lastmod></url>`);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pub.BASE_URL() ? `<url><loc>${esc(pub.BASE_URL())}/jobs</loc></url>` : ''}${urls.join('')}</urlset>`);
  } catch (error) {
    console.error('Error building jobs sitemap:', error);
    res.status(500).send('Server error');
  }
});

// GET /jobs/:id/:slug? — one posting
router.get('/:id/:slug?', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).render('error', { title: 'Not found', message: 'We could not find that job.' });
    const posting = await JobPosting.findById(req.params.id);
    if (!posting || posting.status === 'removed') return res.status(404).render('error', { title: 'Not found', message: 'We could not find that job.' });

    const j = pub.publicShape(posting);
    if (req.params.slug !== pub.slugOf(posting)) return res.redirect(301, j.path);

    const open = pub.isOpenNow(posting);
    const meta = pub.metaFor(j);

    // Who is looking: a candidate sees whether they qualify; a recruiter cannot apply.
    let viewer = { kind: 'guest' };
    let gate = null;
    let application = null;
    if (open && req.session && req.session.candidateId) {
      viewer = { kind: 'candidate' };
      try {
        const candidate = await Candidate.findById(req.session.candidateId);
        if (candidate) {
          viewer.slug = candidate.slug;
          const existing = await JobApplication.findOne({ jobId: posting._id, candidateId: candidate._id });
          const alreadyApplied = Boolean(existing && HAS_APPLIED.includes(existing.status));
          if (existing) application = { active: alreadyApplied, status: existing.status, stageLabel: STAGE_LABEL[existing.status] || '', live: ACTIVE.includes(existing.status),
            appliedAt: existing.appliedAt, withdrawnBy: existing.withdrawnBy, withdrawnNote: existing.withdrawnNote, rejectionText: existing.rejectionText };
          gate = evaluate(await buildCandidateFacts(candidate, { posting: posting.toGateShape(), alreadyApplied }), posting.toGateShape());
          if (req.session.returnTo === j.path) delete req.session.returnTo;
        }
      } catch (e) { console.error('Error checking a candidate against a posting:', e); gate = null; }
    } else if (req.session && req.session.recruiterId) {
      viewer = { kind: 'recruiter', isOwner: String(posting.recruiterId) === String(req.session.recruiterId) };
    }

    const poster = await Recruiter.findById(posting.recruiterId);
    res.status(200).render('job-public', {
      pageTitle: open ? meta.title : `This position is closed | ${j.title} | PreCheckd`,
      metaDescription: open ? meta.description : `${j.title} at ${j.hiringCompany} is no longer taking applications.`,
      canonicalUrl: meta.canonical,
      robotsMeta: open ? '' : 'noindex',
      headExtra: open ? pub.jsonLdScript(pub.jobPostingJsonLd(j)) : '',
      j, open, viewer, gate, application, notice: req.query.applied ? 'applied' : (req.query.withdrew ? 'withdrew' : ''), standard, ...helpers,
      poster: poster && poster.isActive !== false && !poster.isSuspended
        ? { name: [poster.firstName, poster.lastName].filter(Boolean).join(' '), slug: poster.slug } : null,
      postingId: String(posting._id),
    });
  } catch (error) {
    console.error('Error loading job:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
