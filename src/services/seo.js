// Search-engine basics: robots.txt, the main sitemap, and the one rule for which recruiter profiles are public
// enough to be listed. (Job pages have their own sitemap in routes/jobs.js.)
const Recruiter = require('../models/Recruiter');

const BASE_URL = () => (process.env.PUBLIC_BASE_URL || 'https://precheckd.com').replace(/\/$/, '');

// Public marketing pages worth listing. Login-only and per-user pages are deliberately left out.
const STATIC_PATHS = [
  '/',
  '/recruiter-landing',
  '/candidate-landing',
  '/founding-recruiter',
  '/candidate-signup',
  '/is-this-recruiter-real',
  '/recruiter-search',
  '/resources',
  '/skills-explained',
  '/founder',
  '/jobs',
  '/terms',
  '/privacy',
];

// Areas that only make sense when signed in (or are staff/internal). Blocking the crawl keeps search results clean.
const PRIVATE_PATHS = [
  '/api/', '/internal', '/demo', '/go/', '/webhooks',
  '/candidate-dashboard', '/candidate-billing', '/candidate-search',
  '/recruiter-dashboard', '/recruiter-jobs', '/safety', '/mail', '/messages',
  '/connections', '/tracker', '/verify', '/fraud', '/candidate/',
];

// A recruiter profile belongs in search only when the account is real and fully checked.
function isPublicRecruiter(r) {
  return Boolean(r && r.isActive && r.isSuspended !== true && r.accountTier !== 'unverified_claim'
    && r.isPhoneVerified && r.isIdentityVerified);
}

function robotsTxt({ adminHost = false } = {}) {
  if (adminHost) return 'User-agent: *\nDisallow: /\n';
  const lines = ['User-agent: *', 'Allow: /'];
  PRIVATE_PATHS.forEach((p) => lines.push('Disallow: ' + p));
  lines.push('', 'Sitemap: ' + BASE_URL() + '/sitemap.xml', 'Sitemap: ' + BASE_URL() + '/jobs/sitemap.xml', '');
  return lines.join('\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sitemapXml() {
  const urls = STATIC_PATHS.map((p) => BASE_URL() + (p === '/' ? '/' : p));
  require('../content/resources').GUIDES.forEach((g) => urls.push(BASE_URL() + '/resources/' + g.slug));
  try {
    const recruiters = await Recruiter.find({
      isActive: true, isSuspended: { $ne: true }, accountTier: { $ne: 'unverified_claim' },
      isPhoneVerified: true, isIdentityVerified: true,
    }).select('slug updatedAt').lean();
    recruiters.forEach((r) => { if (r.slug) urls.push(BASE_URL() + '/recruiter/' + encodeURIComponent(r.slug)); });
  } catch (e) {
    console.error('Error listing recruiters for sitemap:', e);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + urls.map((u) => '<url><loc>' + esc(u) + '</loc></url>').join('') + '</urlset>';
}

// Short, plain description for a recruiter's public page.
function recruiterMeta(r) {
  const name = [r.firstName, r.lastName].filter(Boolean).join(' ');
  const company = r.company && r.company !== 'Not provided' ? r.company : '';
  const pub = isPublicRecruiter(r);
  return {
    pageTitle: pub ? `${name} - Verified Recruiter${company ? ' at ' + company : ''} | PreCheckd` : `${name} | PreCheckd`,
    metaDescription: pub
      ? `${name} is a verified recruiter${company ? ' at ' + company : ''} on PreCheckd. Identity, phone and email were checked before they could contact candidates.`
      : `${name} on PreCheckd.`,
    canonicalUrl: BASE_URL() + '/recruiter/' + encodeURIComponent(r.slug),
    robotsMeta: pub ? '' : 'noindex',
  };
}

module.exports = { BASE_URL, STATIC_PATHS, PRIVATE_PATHS, isPublicRecruiter, robotsTxt, sitemapXml, recruiterMeta };
