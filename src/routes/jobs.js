// Public job pages: anyone can read an open posting without logging in (see docs/job-board-spec.md, section 3).
// Never shows the street address or the recruiter's internal label. Applying comes in the next step.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const JobPosting = require('../models/JobPosting');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { evaluate } = require('../services/applyGate');
const { buildCandidateFacts } = require('../services/applyFacts');
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
    const jobs = all.map(pub.publicShape).filter((j) => (!arrangement || j.arrangement === arrangement)
      && (!q || [j.title, j.hiringCompany, j.location, ...j.skills.map((s) => s.label)].join(' ').toLowerCase().includes(q)));
    res.render('jobs-list', {
      pageTitle: 'Open jobs | PreCheckd',
      metaDescription: 'Jobs where every applicant has a verified identity, tested skills and verified credentials.',
      canonicalUrl: pub.BASE_URL() + '/jobs',
      jobs, q, arrangement, totalOpen: all.length, ...helpers,
      pins: jobs.filter((j) => j.circle).map((j) => ({ id: j.id, path: j.path, title: j.title, company: j.hiringCompany, circle: j.circle })),
    });
  } catch (error) {
    console.error('Error loading jobs:', error);
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
    if (open && req.session && req.session.candidateId) {
      viewer = { kind: 'candidate' };
      try {
        const candidate = await Candidate.findById(req.session.candidateId);
        if (candidate) {
          viewer.slug = candidate.slug;
          gate = evaluate(await buildCandidateFacts(candidate, { posting: posting.toGateShape() }), posting.toGateShape());
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
      j, open, viewer, gate, standard, ...helpers,
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
