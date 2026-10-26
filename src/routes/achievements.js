const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const ach = require('../services/achievements');

// Public page for one shared skill level. 404 when the candidate has not shared it (or stopped).
router.get('/:slug/:key', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });
    const v = ach.publicView(candidate, req.params.key);
    if (!v) return res.status(404).render('error', { title: 'Not found', message: 'This achievement is not being shared.' });
    const owner = req.session.candidateId && req.session.candidateId === candidate._id.toString();
    if (req.query.ref === 'share' && !owner) {
      Candidate.updateOne({ _id: candidate._id }, { $inc: { achievementVisits: 1 } }).catch(() => {});
    }
    const url = ach.urlFor(candidate, v.key);
    res.set('X-Robots-Tag', 'noindex');
    res.render('achievement', {
      v, url, pageTitle: `${v.headline}`,
      metaDescription: `${v.headline}. Verified skill assessment taken on PreCheckd.`,
      canonicalUrl: url,
      headExtra: `<meta property="og:image" content="${ach.baseUrl()}/img/share/${v.card}.png"><meta name="twitter:card" content="summary_large_image">`
    });
  } catch (e) {
    console.error('Error loading achievement page:', e);
    res.status(500).send('Server error');
  }
});

module.exports = router;
