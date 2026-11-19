// Tagged links: precheckd.com/go/<tag> counts the visit and sends the visitor to the demo site.
const express = require('express');
const sources = require('../services/sources');

const router = express.Router();

router.get('/:src', async (req, res) => {
  const tag = sources.clean(req.params.src);
  if (tag && !sources.isBot(req)) {
    try {
      if (req.session && req.session.src !== tag) { req.session.src = tag; await sources.record(tag, 'demo'); }
    } catch (err) { console.error('Source tracking failed:', err.message); }
  }
  res.redirect(302, `${sources.demoUrl()}/demo`);
});

module.exports = router;
