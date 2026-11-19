const express = require('express');
const router = express.Router();
const seo = require('../services/seo');

const ADMIN_HOSTNAME = () => process.env.ADMIN_HOSTNAME || 'admin.precheckd.com';

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(seo.robotsTxt({ adminHost: req.hostname === ADMIN_HOSTNAME() }));
});

router.get('/sitemap.xml', async (req, res) => {
  if (req.hostname === ADMIN_HOSTNAME()) return res.status(404).send('Not found');
  res.type('application/xml').send(await seo.sitemapXml());
});

module.exports = router;
