const express = require('express');
const OutsideInterest = require('../models/OutsideInterest');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const US_RE = /^(us|usa|u\.s\.a?\.?|united states( of america)?|america)$/i;
const WHO = ['candidate', 'recruiter', 'not-sure'];
const PER_HOUR = 5;
const hits = new Map(); // ip -> timestamps (ms); resets on restart, which is fine for a form this small

function overLimit(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - 60 * 60 * 1000);
  const blocked = list.length >= PER_HOUR;
  if (!blocked) list.push(now);
  hits.set(ip, list);
  return blocked;
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [ip, list] of hits) if (!list.some((t) => t > cutoff)) hits.delete(ip);
}, 60 * 60 * 1000).unref();

// "Not in the US? Tell us where." Saves one row per email.
router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const b = req.body || {};
  // Hidden field only bots fill in: pretend it worked and save nothing.
  if (typeof b.website === 'string' && b.website.trim()) return res.json({ ok: true });
  if (overLimit(req.ip)) return res.status(429).json({ error: 'Too many tries. Please try again later.' });

  const email = String(b.email || '').trim().toLowerCase();
  const country = String(b.country || '').trim().replace(/\s+/g, ' ');
  const who = WHO.includes(b.who) ? b.who : 'not-sure';
  const page = String(b.page || '').trim().slice(0, 40);

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (country.length < 2 || country.length > 60) return res.status(400).json({ error: 'Please tell us which country you are in.' });
  if (US_RE.test(country)) return res.status(400).json({ error: "That's the US, so you can sign up right now." });

  try {
    await OutsideInterest.updateOne({ email }, { $set: { country, who, page }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving outside-US interest:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
