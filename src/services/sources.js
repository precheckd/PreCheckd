// Where visitors and signups come from. A link is tagged with a short name:
//   precheckd.com/go/li-dm       counts a visit, then sends the visitor to the demo site
//   precheckd.com/?src=li-post   counts a visit to any page on the main site
// The tag is remembered in the visitor's session, and a new recruiter or candidate account records it as `source`.
const SourceVisit = require('../models/SourceVisit');
const demo = require('../config/demo');

const TAG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const clean = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return TAG.test(s) ? s : null; };
// Link-preview robots (LinkedIn, Slack, Facebook and the like) fetch a link when it is pasted; they are not visitors.
const isBot = (req) => req.method === 'HEAD' || /bot|crawl|spider|preview|facebookexternalhit|slurp|whatsapp|embedly|curl|python-requests|headless/i.test((req.get && req.get('user-agent')) || '');
const dayOf = (now = new Date()) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function record(src, target, now = new Date()) {
  const tag = clean(src);
  if (!tag) return false;
  await SourceVisit.updateOne({ src: tag, target, day: dayOf(now) }, { $inc: { count: 1 } }, { upsert: true });
  return true;
}

// Counts a tagged visit once per visitor session, so refreshing the page does not inflate it.
function middleware() {
  return async (req, res, next) => {
    try {
      if (demo.enabled() || req.method !== 'GET' || req.query.src === undefined || isBot(req)) return next();
      const tag = clean(req.query.src);
      if (tag && req.session && req.session.src !== tag) {
        req.session.src = tag;
        await record(tag, 'site');
      }
    } catch (err) { console.error('Source tracking failed:', err.message); }
    return next();
  };
}

const demoUrl = () => (process.env.DEMO_SITE_URL || 'https://demo.precheckd.com').replace(/\/$/, '');

// Staff view: for each tag, visits (demo and site) and the accounts created with it, over the last `days` days.
async function overview({ days = 30, now = new Date() } = {}) {
  const Recruiter = require('../models/Recruiter');
  const Candidate = require('../models/Candidate');
  const since = new Date(now.getTime() - days * 86400000);
  const sinceDay = dayOf(since);
  const rows = new Map();
  const get = (src) => { if (!rows.has(src)) rows.set(src, { src, demo: 0, site: 0, recruiters: 0, candidates: 0 }); return rows.get(src); };
  (await SourceVisit.find({ day: { $gte: sinceDay } })).forEach((v) => { get(v.src)[v.target] += v.count; });
  for (const [key, Model] of [['recruiters', Recruiter], ['candidates', Candidate]]) {
    (await Model.aggregate([{ $match: { source: { $ne: null }, createdAt: { $gte: since } } }, { $group: { _id: '$source', n: { $sum: 1 } } }]))
      .forEach((g) => { get(g._id)[key] = g.n; });
  }
  const list = [...rows.values()].sort((a, b) => (b.demo + b.site) - (a.demo + a.site) || a.src.localeCompare(b.src));
  const total = list.reduce((t, r) => ({ demo: t.demo + r.demo, site: t.site + r.site, recruiters: t.recruiters + r.recruiters, candidates: t.candidates + r.candidates }), { demo: 0, site: 0, recruiters: 0, candidates: 0 });
  return { days, rows: list, total };
}

module.exports = { isBot, clean, record, middleware, demoUrl, overview, dayOf };
