// Real, PreCheckd-wide totals for the homepage activity ticker.
//
// Only genuine numbers from the database are ever shown, and each counter
// stays hidden until it reaches a minimum — "3 connections made" would hurt
// the pitch, so a counter only appears once it helps. If nothing qualifies,
// the ticker doesn't render at all. All-time totals (not "this week") so the
// figures only ever go up.
//
// Thresholds can be changed without a deploy via environment variables, and
// the whole ticker can be switched off with DISABLE_TICKER=true.
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const ConnectionRequest = require('../models/ConnectionRequest');

const CACHE_MS = 10 * 60 * 1000;

function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function minimums() {
  return {
    candidates: envInt('TICKER_MIN_CANDIDATES', 250),
    recruiters: envInt('TICKER_MIN_RECRUITERS', 50),
    connections: envInt('TICKER_MIN_CONNECTIONS', 100)
  };
}

let cache = null;

async function computeCounters() {
  const [candidates, recruiters, connections] = await Promise.all([
    // Fully verified job seekers (phone + identity), the ones recruiters can find.
    Candidate.countDocuments({ isPhoneVerified: true, isIdentityVerified: true }),
    // Live, verified recruiters — not suspended, not an unverified fraud-report claim account.
    Recruiter.countDocuments({
      isActive: true,
      isSuspended: { $ne: true },
      accountTier: { $ne: 'unverified_claim' }
    }),
    ConnectionRequest.countDocuments({ status: 'accepted' })
  ]);

  return { candidates, recruiters, connections };
}

// Returns the list of ticker items to show: [{ key, value, label }], possibly
// empty. Never throws — a failure just means no ticker.
async function getTickerItems({ now = Date.now() } = {}) {
  if (process.env.DISABLE_TICKER === 'true') return [];

  try {
    if (!cache || now - cache.at > CACHE_MS) {
      cache = { at: now, counters: await computeCounters() };
    }
  } catch (error) {
    console.error('Error loading site stats for ticker:', error);
    return [];
  }

  const { counters } = cache;
  const min = minimums();
  const items = [];

  if (counters.candidates >= min.candidates) {
    items.push({ key: 'candidates', value: counters.candidates, label: 'verified job seekers' });
  }
  if (counters.recruiters >= min.recruiters) {
    items.push({ key: 'recruiters', value: counters.recruiters, label: 'verified recruiters' });
  }
  if (counters.connections >= min.connections) {
    items.push({ key: 'connections', value: counters.connections, label: 'connections made' });
  }

  return items;
}

// For tests.
function _resetCache() {
  cache = null;
}

module.exports = { getTickerItems, _resetCache };
