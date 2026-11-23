// Finds each school's registrar/verification contact from the school's own public website.
// Pure helpers plus scrapeSchool(), which takes its web fetcher and model caller as arguments so it can be tested.
// A contact is "confirmed" only if the email really appears on a page we fetched AND belongs to the school's own domain.
const { domainOf } = require('../utils/schoolDomain');

const USER_AGENT = 'PreCheckdSchoolDirectoryBot/1.0 (+https://precheckd.com; verifications@precheckd.com)';
const GUESS_PATHS = ['/registrar', '/registrar/', '/records', '/student-records', '/registrar/contact', '/registrar/verification'];
const LINK_SCORES = [[/enrollment.?verif|degree.?verif|verification/i, 6], [/registrar/i, 5], [/records|transcript/i, 3]];
const MAX_PAGES = 4;
const MAX_PAGE_CHARS = 6000;

// ---- HTML helpers (no parser library: we only need text, links, mailto and tel) ----
const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (m) => entities[m]).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));

function htmlToText(html) {
  return decode(String(html || '').replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h\d|br|section)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function links(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { out.push({ href: new URL(decode(m[1]), baseUrl).href, text: htmlToText(m[2]).slice(0, 120) }); } catch (e) { /* bad href */ }
  }
  return out;
}

const mailtos = (html) => [...new Set([...String(html || '').matchAll(/mailto:([^"'?\s<>]+)/gi)].map((m) => decode(m[1]).toLowerCase()))];
const tels = (html) => [...new Set([...String(html || '').matchAll(/tel:([+\d\-().\s]{7,20})/gi)].map((m) => decode(m[1]).trim()))];

// ---- robots.txt (the "*" group and ours) ----
function parseRobots(text) {
  const groups = []; let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(); const v = line.slice(i + 1).trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if ((k === 'disallow' || k === 'allow') && cur) cur.rules.push({ allow: k === 'allow', path: v });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && USER_AGENT.toLowerCase().includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  return {
    allowed(path) {
      let best = null;
      for (const r of rules) {
        if (!r.path) continue;
        const pat = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
        if (pat.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
      }
      return !best || best.allow;
    },
  };
}

// ---- choosing pages ----
function pickPages(homepageHtml, origin) {
  const host = new URL(origin).host.replace(/^www\./, '');
  const scored = new Map();
  for (const l of links(homepageHtml, origin)) {
    let u; try { u = new URL(l.href); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol) || !(u.host.replace(/^www\./, '') === host || u.host.endsWith('.' + host))) continue;
    if (/\.(pdf|docx?|xlsx?|zip|png|jpe?g)$/i.test(u.pathname)) continue;
    const text = `${u.pathname} ${l.text}`;
    const score = LINK_SCORES.reduce((s, [re, w]) => s + (re.test(text) ? w : 0), 0);
    if (score > 0) scored.set(u.href, Math.max(score, scored.get(u.href) || 0));
  }
  const picked = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, MAX_PAGES);
  for (const p of GUESS_PATHS) { if (picked.length >= MAX_PAGES) break; const h = new URL(p, origin).href; if (!picked.includes(h)) picked.push(h); }
  return picked;
}

// ---- the model ----
const SYSTEM = `You read pages from a US college or university website and find how to send the registrar a request to verify a graduate's degree or enrollment.
Reply with JSON only, no other text: {"email": string|null, "phone": string|null, "clearinghouseOnly": boolean, "notes": string}
Rules: use ONLY what the pages say. The email must be copied exactly from the pages and be the registrar/records/verification address, not an unrelated office. If several addresses exist, prefer one for verifications, then the registrar or records office. clearinghouseOnly is true only if the pages say degree or enrollment verifications are handled through the National Student Clearinghouse (or another third party) and not by direct request. notes: at most 20 words, for example "web form only" or "uses Clearinghouse". If you cannot find a contact, use null.`;

function buildPrompt(school, pages) {
  const body = pages.map((p) => `PAGE ${p.url}\nEmails on page: ${p.mailtos.join(', ') || 'none'}\nPhones on page: ${p.tels.join(', ') || 'none'}\n${p.text}`).join('\n\n---\n\n');
  return `School: ${school.name}\nWebsite: ${school.website}\n\n${body}`;
}

function parseModelJson(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || '')); if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return { email: typeof j.email === 'string' ? j.email.trim().toLowerCase() : null, phone: typeof j.phone === 'string' ? j.phone.trim().slice(0, 40) : null,
      clearinghouseOnly: j.clearinghouseOnly === true, notes: typeof j.notes === 'string' ? j.notes.trim().slice(0, 200) : '' };
  } catch (e) { return null; }
}

const sameSite = (emailDomain, schoolDomain) => emailDomain === schoolDomain || emailDomain.endsWith('.' + schoolDomain) || schoolDomain.endsWith('.' + emailDomain);

// Turns the model's answer into a directory row. Nothing the pages don't show can become "confirmed".
function decide(school, ex, pages) {
  const row = { name: school.name, ipedsId: school.ipedsId, website: school.website, registrarEmail: '', registrarPhone: '', sourceUrl: '', clearinghouseOnly: '', notes: '' };
  if (!ex) { row.notes = 'no usable answer'; return row; }
  row.notes = ex.notes || '';
  if (ex.phone) row.registrarPhone = ex.phone;
  if (ex.clearinghouseOnly) { row.clearinghouseOnly = 'yes'; row.notes = row.notes || 'uses Clearinghouse'; return row; }
  const dom = domainOf(school.website);
  const email = ex.email;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && dom && sameSite(email.split('@')[1], dom)) {
    const found = pages.find((p) => p.mailtos.includes(email) || p.text.toLowerCase().includes(email));
    if (found) { row.registrarEmail = email; row.sourceUrl = found.url; } else row.notes = (row.notes + ' email not found on page').trim();
  }
  return row;
}

// ---- one school ----
// deps: { fetchPage(url) -> {ok, html, url} | null,  robotsFor(origin) -> {allowed(path)},  callModel(system, user) -> {text, usage} }
async function scrapeSchool(school, deps) {
  const tally = { inTokens: 0, outTokens: 0 };
  const dom = domainOf(school.website);
  const failed = (why) => { const row = decide(school, null, []); row.notes = why; return { row, tally, error: why }; };
  if (!dom) return failed('no website');
  const origin = `https://${school.website.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]}`;
  const robots = await deps.robotsFor(origin);
  const get = async (u) => { try { if (!robots.allowed(new URL(u).pathname)) return null; return await deps.fetchPage(u); } catch (e) { return null; } };
  const home = await get(origin + '/');
  if (!home || !home.ok) return failed('site unreachable');
  const pages = [];
  for (const u of pickPages(home.html, home.url || origin)) {
    const p = await get(u);
    if (p && p.ok) pages.push({ url: p.url || u, mailtos: mailtos(p.html), tels: tels(p.html), text: htmlToText(p.html).slice(0, MAX_PAGE_CHARS) });
  }
  if (!pages.length) return failed('no registrar page found');
  const res = await deps.callModel(SYSTEM, buildPrompt(school, pages));
  tally.inTokens = (res.usage && res.usage.input_tokens) || 0; tally.outTokens = (res.usage && res.usage.output_tokens) || 0;
  return { row: decide(school, parseModelJson(res.text), pages), tally, error: null };
}

module.exports = { USER_AGENT, htmlToText, links, mailtos, tels, parseRobots, pickPages, buildPrompt, parseModelJson, decide, scrapeSchool, SYSTEM };
