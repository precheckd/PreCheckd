// GET /api/schools?q=wes — school names for the education picker. Names only; no contact details leave the server.
const express = require('express');
const router = express.Router();
const schools = require('../services/schools');

const hits = new Map();
router.get('/', async (req, res) => {
  try {
    const ip = req.ip || 'x';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= 60) return res.status(429).json({ schools: [] });
    recent.push(now); hits.set(ip, recent);
    res.json({ schools: await schools.suggest(String(req.query.q || '').slice(0, 80)) });
  } catch (e) {
    console.error('School search failed:', e.message);
    res.json({ schools: [] });
  }
});

module.exports = router;
