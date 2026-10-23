// What the PUBLIC sees of a job posting: a safe copy (never the street address, internal label or exact
// point), a blurred map circle, link-preview text and search-engine job markup. Pure functions.
const crypto = require('crypto');
const opt = require('../content/postingOptions');

const BLUR_MILES = 2.5;
const BASE_URL = () => (process.env.PUBLIC_BASE_URL || 'https://precheckd.com').replace(/\/$/, '');

function label(list, code) { const f = list.find((x) => x.code === code); return f ? f.label : code; }
function money(n) { return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
function slugOf(p) { return slugify(`${p.title} ${p.hiringCompany}`) || 'job'; }
function pathOf(p) { return `/jobs/${p._id}/${slugOf(p)}`; }

// Open and still before the close date (the close date is the end of that day in New York, already stored so).
function isOpenNow(p, now = Date.now()) {
  return p.status === 'open' && (!p.closeDate || new Date(p.closeDate).getTime() >= now);
}

// A map circle that contains the real spot but is NOT centred on it. The shift is derived from a server
// secret, so the same posting always draws the same circle and the real point cannot be worked out from it.
function blurredCircle(point, id, secret = process.env.SESSION_SECRET || 'dev-secret-key') {
  if (!Array.isArray(point) || point.length !== 2) return null;
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest();
  const angle = (h.readUInt32BE(0) / 0xffffffff) * 2 * Math.PI;
  const dist = (0.3 + 0.6 * (h.readUInt32BE(4) / 0xffffffff)) * BLUR_MILES; // 0.3R to 0.9R from the centre
  const [lng, lat] = point;
  const dLat = (dist * Math.sin(angle)) / 69;
  const dLng = (dist * Math.cos(angle)) / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { lat: Number((lat + dLat).toFixed(3)), lng: Number((lng + dLng).toFixed(3)), radiusMiles: BLUR_MILES };
}

function locationText(p) {
  const place = [p.displayCity, p.displayState].filter(Boolean).join(', ');
  if (p.arrangement === 'remote') return 'Remote';
  if (p.arrangement === 'remote_in_area') return `Remote, limited to ${p.areaLabel || 'certain areas'}`;
  return `${place}${p.arrangement === 'hybrid' ? ' (hybrid)' : ''}`;
}

function payText(p) {
  const per = p.basePayType === 'hourly' ? ' an hour' : ' a year';
  if (p.commissionOnly) return 'Commission only';
  return `${money(p.baseMin)} to ${money(p.baseMax)}${per}`;
}

// The only shape the public templates ever see.
function publicShape(p) {
  const circle = (p.arrangement === 'onsite' || p.arrangement === 'hybrid' || (p.arrangement === 'remote_in_area' && p.areaReason === 'radius'))
    && p.areaRule && p.areaRule.point ? blurredCircle(p.areaRule.point, p._id) : null;
  return {
    id: String(p._id), path: pathOf(p), title: p.title, seniorityLabel: p.seniorityLabel, hiringCompany: p.hiringCompany,
    employmentType: p.employmentType, contractLength: p.contractLength, openings: p.openings,
    arrangement: p.arrangement, inOfficeDays: p.inOfficeDays, areaLabel: p.areaLabel, location: locationText(p),
    displayCity: p.displayCity, displayState: p.displayState, relocation: p.relocation, travel: p.travel, shift: p.shift,
    basePayType: p.basePayType, baseMin: p.baseMin, baseMax: p.baseMax, commissionOnly: p.commissionOnly, payBasis: p.payBasis,
    commission: p.commission, bonus: p.bonus, equity: p.equity, tips: p.tips,
    benefits: p.benefits, benefitsOther: p.benefitsOther, noBenefits: p.noBenefits,
    education: p.education, clearance: p.clearance,
    skills: (p.skills || []).map((s) => ({ key: s.key, label: s.label, minLevel: s.minLevel })),
    certGroups: (p.certGroups || []).map((g) => g.certs.map((c) => c.label)),
    startDate: p.startDate, startFirm: p.startFirm, closeDate: p.closeDate,
    summary: p.summary, responsibilities: p.responsibilities,
    createdAt: p.createdAt, editedAt: p.editedAt, status: p.status, circle,
    payLine: payText(p),
  };
}

function metaFor(j) {
  const skills = j.skills.map((s) => s.label).join(', ');
  const bits = [`${j.hiringCompany}`, j.location, j.payLine, skills ? `Skills: ${skills}` : ''].filter(Boolean);
  return {
    title: `${j.title} at ${j.hiringCompany}${j.displayCity ? ' - ' + [j.displayCity, j.displayState].filter(Boolean).join(', ') : ''} | PreCheckd`,
    description: bits.join(' · ').slice(0, 280),
    canonical: BASE_URL() + j.path,
  };
}

const EMPLOYMENT_SCHEMA = { full_time: 'FULL_TIME', part_time: 'PART_TIME', contract: 'CONTRACTOR', temp: 'TEMPORARY', internship: 'INTERN' };

// schema.org JobPosting. Never includes the street address, only city and state.
function jobPostingJsonLd(j) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'JobPosting',
    title: j.title,
    description: [j.summary, ...(j.responsibilities || []).map((r) => `- ${r}`)].join('\n'),
    datePosted: new Date(j.createdAt).toISOString().slice(0, 10),
    validThrough: new Date(j.closeDate).toISOString(),
    employmentType: EMPLOYMENT_SCHEMA[j.employmentType] || 'OTHER',
    hiringOrganization: { '@type': 'Organization', name: j.hiringCompany },
    directApply: true,
    url: BASE_URL() + j.path,
  };
  if (j.arrangement === 'remote' || j.arrangement === 'remote_in_area') {
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = { '@type': 'Country', name: 'US' };
  }
  if (j.displayCity || j.displayState) {
    ld.jobLocation = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.displayCity || undefined, addressRegion: j.displayState || undefined, addressCountry: 'US' } };
  }
  if (!j.commissionOnly && j.baseMax > 0) {
    ld.baseSalary = { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: j.baseMin, maxValue: j.baseMax, unitText: j.basePayType === 'hourly' ? 'HOUR' : 'YEAR' } };
  }
  return ld;
}

// Safe to place inside a <script> tag.
function jsonLdScript(ld) {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const json = JSON.stringify(ld).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
  return '<script type="application/ld+json">' + json + '</script>';
}

module.exports = { BLUR_MILES, blurredCircle, publicShape, metaFor, jobPostingJsonLd, jsonLdScript, isOpenNow, slugOf, pathOf, slugify, locationText, payText, label, money, BASE_URL };
