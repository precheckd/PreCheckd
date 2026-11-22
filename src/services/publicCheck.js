// The public "Is this recruiter real?" check. Anyone can use it without an account, so it is deliberately narrower
// than the signed-in checker: it only looks at the domain's age and whether the exact address belongs to a fully
// verified PreCheckd recruiter. It never reveals fraud reports, and it never emails anyone.
// The domain-age lookup is a paid service, so lookups are limited per visitor and per day, and answers are cached.
const { checkDomainAge } = require('../utils/domainAgeCheck');
const Recruiter = require('../models/Recruiter');
const seo = require('./seo');
const domainDns = require('./domainDns');
const lookalike = require('./lookalike');

const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
]);

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+$/;

function parseEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  const domain = email.split('@')[1];
  if (!DOMAIN_RE.test(domain)) return null;
  return { email, domain };
}

// --- limits ---------------------------------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const state = { perIp: new Map(), day: { start: 0, count: 0 }, cache: new Map() };

const perIpLimit = () => Number(process.env.PUBLIC_CHECK_PER_HOUR) || 10;
const dailyCap = () => Number(process.env.PUBLIC_CHECK_DAILY_CAP) || 300;

// Returns null when the lookup may go ahead, otherwise a short reason. Counts the lookup when allowed.
function allow(ip, now = Date.now()) {
  if (now - state.day.start >= DAY) state.day = { start: now, count: 0 };
  if (state.day.count >= dailyCap()) return 'busy';
  const hits = (state.perIp.get(ip) || []).filter((t) => now - t < HOUR);
  if (hits.length >= perIpLimit()) { state.perIp.set(ip, hits); return 'slow-down'; }
  hits.push(now);
  state.perIp.set(ip, hits);
  state.day.count += 1;
  if (state.perIp.size > 5000) for (const [k, v] of state.perIp) if (!v.some((t) => now - t < HOUR)) state.perIp.delete(k);
  return null;
}

function reset() { state.perIp = new Map(); state.day = { start: 0, count: 0 }; state.cache = new Map(); }

async function domainAge(domain, now = Date.now()) {
  const hit = state.cache.get(domain);
  if (hit && now - hit.at < DAY) return hit.value;
  const value = await checkDomainAge(domain);
  // Don't remember a failed lookup; try again next time.
  if (value && value.reason !== 'lookup_failed') {
    if (state.cache.size > 5000) state.cache.clear();
    state.cache.set(domain, { at: now, value });
  }
  return value;
}

// Plain-English age: "5 days", "about 3 weeks", "about 8 months", "about 3 years".
function ageText(days) {
  if (days < 14) return days + (days === 1 ? ' day' : ' days');
  if (days < 60) return 'about ' + Math.round(days / 7) + ' weeks';
  if (days < 730) return 'about ' + Math.round(days / 30.4) + ' months';
  return 'about ' + Math.floor(days / 365) + ' years';
}

// How much weight the age deserves: under a month is a strong warning, under six months a mild one.
function ageBand(days) { return days < 30 ? 'very_new' : days < 180 ? 'recent' : 'established'; }

// --- the check ------------------------------------------------------------------------------------------------
async function run(email, domain) {
  const freeProvider = FREE_PROVIDERS.has(domain);
  let age = null;
  let dns = null;
  let similar = null;
  if (!freeProvider) {
    const [r, d] = await Promise.all([domainAge(domain), domainDns.check(domain).catch(() => ({ mail: 'unknown', web: 'unknown' }))]);
    dns = d;
    similar = lookalike.check(domain);
    if (r && (r.verified || r.reason === 'too_new') && typeof r.ageInDays === 'number') {
      age = { status: r.verified ? 'established' : 'new', days: r.ageInDays, text: ageText(r.ageInDays), band: ageBand(r.ageInDays) };
      if (r.createdDate) age.year = r.registeredYear;
      // Only a long registration is worth showing; a short one proves nothing, so it is not mentioned.
      if (r.expiresDate && r.expiresDate.getTime() - Date.now() >= 2 * 365 * 86400000) age.paidThrough = r.expiresDate.getFullYear();
    } else age = { status: 'unknown' };
  }

  let verified = null;
  const account = await Recruiter.findOne({
    email, accountTier: { $ne: 'unverified_claim' }, isActive: true, isSuspended: { $ne: true },
    isPhoneVerified: true, isIdentityVerified: true,
  }).select('firstName lastName company slug isActive isSuspended accountTier isPhoneVerified isIdentityVerified');
  if (account && seo.isPublicRecruiter(account)) {
    verified = {
      name: [account.firstName, account.lastName].filter(Boolean).join(' '),
      company: account.company && account.company !== 'Not provided' ? account.company : null,
      profileUrl: '/recruiter/' + encodeURIComponent(account.slug),
    };
  }
  return { email, domain, freeProvider, age, dns, similar, verified };
}

module.exports = { parseEmail, allow, reset, run, ageText, ageBand, FREE_PROVIDERS };
