const express = require('express');
const { answer } = require('../services/chatAssistant');

const router = express.Router();

// Per-visitor limits (in memory, one Render instance, same pattern as the
// admin login limiter). A restart resets them early; the daily dollar cap in
// chatAssistant.js is the real backstop and lives in the database.
const PER_MINUTE = 6;
const PER_HOUR = 30;
const PER_DAY = 80;
const hits = new Map(); // ip -> array of timestamps (ms)

function overLimit(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - 24 * 60 * 60 * 1000);
  const inLast = (ms) => list.filter((t) => t > now - ms).length;
  const blocked = inLast(60 * 1000) >= PER_MINUTE || inLast(60 * 60 * 1000) >= PER_HOUR || list.length >= PER_DAY;
  if (!blocked) list.push(now);
  hits.set(ip, list);
  return blocked;
}

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [ip, list] of hits) {
    if (!list.some((t) => t > cutoff)) hits.delete(ip);
  }
}, 60 * 60 * 1000).unref();

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (overLimit(req.ip)) {
    return res.status(429).json({ reply: "You're sending messages quickly. Please wait a minute and try again, or email hello@precheckd.com." });
  }
  const { status, reply } = await answer({
    messages: req.body && req.body.messages,
    conversationId: req.body && req.body.conversationId,
    ip: req.ip
  });
  res.status(status).json({ reply });
});

module.exports = router;
