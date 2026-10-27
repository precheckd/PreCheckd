const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const JobApplication = require('../models/JobApplication');
const JobPosting = require('../models/JobPosting');
const ach = require('../services/achievements');

// Owner-only page where a candidate who was hired through PreCheckd chooses whether (and how) to announce it.
// Nothing is public until they save; the company name and hashtag are included only if they choose them.
async function load(req, res) {
  if (!req.session.candidateId) { res.status(403).send('You must be logged in to view this page.'); return null; }
  const candidate = await Candidate.findOne({ slug: req.params.slug });
  if (!candidate) { res.status(404).send('Candidate not found.'); return null; }
  if (String(candidate._id) !== String(req.session.candidateId)) { res.status(403).send('You do not have permission to view this page.'); return null; }
  if (!/^[a-f0-9]{24}$/i.test(String(req.params.appId))) { res.status(404).send('Not found.'); return null; }
  const app = await JobApplication.findOne({ _id: req.params.appId, candidateId: candidate._id, status: 'hired' });
  if (!app) { res.status(404).send('Not found.'); return null; }
  const posting = await JobPosting.findById(app.jobId);
  return { candidate, app, posting };
}

router.get('/:slug/share-hire/:appId', async (req, res) => {
  try {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { candidate, app, posting } = ctx;
    const v = ach.hireView(candidate, app._id);
    const url = ach.hireUrlFor(candidate, app._id);
    res.render('hire-share', {
      title: 'Share your news | PreCheckd', candidate, appId: String(app._id),
      jobTitle: posting ? posting.title : 'your new role', company: posting ? posting.hiringCompany : '',
      shared: !!v, v, url, links: v ? ach.hireShareLinks(v, url) : null, saved: req.query.saved === '1'
    });
  } catch (e) {
    console.error('Error loading hire share page:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/share-hire/:appId', async (req, res) => {
  try {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { candidate, app, posting } = ctx;
    await ach.setHireShare(candidate, app._id, {
      on: req.body.on === '1',
      includeCompany: req.body.companyMode === 'company',
      company: posting ? posting.hiringCompany : '',
      hashtag: req.body.hashtag
    });
    res.redirect(`/candidate/${candidate.slug}/share-hire/${app._id}?saved=${req.body.on === '1' ? '1' : '0'}`);
  } catch (e) {
    console.error('Error saving hire share:', e);
    res.status(500).send('Server error');
  }
});

module.exports = router;
