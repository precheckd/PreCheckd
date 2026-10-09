// Profile view counting: unique viewers per profile per calendar month.
// Never throws and never blocks a page render — a tracking failure just
// means one view isn't counted.
const crypto = require('crypto');
const PageView = require('../models/PageView');

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|headless|python-requests|monitor|uptime/i;

function periodFor(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function viewerKeyFor(req) {
  if (req.session && req.session.recruiterId) return `r:${req.session.recruiterId}`;
  if (req.session && req.session.candidateId) return `c:${req.session.candidateId}`;
  // Anonymous: salted hash so no raw IP is stored.
  const salt = process.env.SESSION_SECRET || 'precheckd-view-salt';
  const raw = `${req.ip || ''}|${req.get('user-agent') || ''}`;
  return `a:${crypto.createHash('sha256').update(`${salt}|${raw}`).digest('hex').slice(0, 32)}`;
}

function looksAutomated(req) {
  if (req.method !== 'GET') return true;
  const ua = req.get('user-agent') || '';
  if (!ua || BOT_PATTERN.test(ua)) return true;
  const purpose = `${req.get('purpose') || ''}${req.get('sec-purpose') || ''}`;
  return /prefetch|prerender/i.test(purpose);
}

// Records one unique view. Skips the owner's own visits and bots/prefetches.
async function recordView(req, ownerType, ownerId, { viewerIsOwner = false, now = new Date() } = {}) {
  try {
    if (viewerIsOwner || looksAutomated(req)) return false;
    await PageView.updateOne(
      { ownerType, ownerId, viewerKey: viewerKeyFor(req), period: periodFor(now) },
      { $setOnInsert: { firstViewedAt: now } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    // Duplicate-key races on the unique index are fine (already counted).
    if (!(error && error.code === 11000)) {
      console.error('Error recording profile view:', error);
    }
    return false;
  }
}

// { thisMonth, allTime } — allTime is the sum of each month's unique viewers.
async function getViewCounts(ownerType, ownerId, { now = new Date() } = {}) {
  try {
    const [thisMonth, allTime] = await Promise.all([
      PageView.countDocuments({ ownerType, ownerId, period: periodFor(now) }),
      PageView.countDocuments({ ownerType, ownerId })
    ]);
    return { thisMonth, allTime };
  } catch (error) {
    console.error('Error loading profile view counts:', error);
    return { thisMonth: 0, allTime: 0 };
  }
}

module.exports = { recordView, getViewCounts, periodFor };
