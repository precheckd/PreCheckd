// Best-effort copy of a job posting (roadmap #5), so a candidate still has the
// description when the interview request arrives a month later.
//
// This fetches a URL the MEMBER typed, so it is hardened against server-side
// request forgery: http/https only, standard ports, no credentials, every
// address the name resolves to must be public, the connection is made to the
// address we checked (no second lookup to rebind), redirects are re-checked,
// and time, size and content type are capped. Failures return null; the caller
// treats that as "couldn't save a copy", never as an error.
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

const MAX_BYTES = 1500000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 6000;
const MAX_CHARS = 20000;

function ipv4Blocked(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)   // carrier-grade NAT
    || (a === 169 && b === 254)             // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;                            // multicast and reserved
}

function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) return ipv4Blocked(ip);
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Blocked(mapped[1]);
    return v === '::' || v === '::1' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')
      || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('ff') || v.startsWith('::ffff:');
  }
  return true;
}

function checkUrl(u) {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return port === '80' || port === '443';
}

// Resolves the host and refuses unless EVERY address is public. Returns one to connect to.
async function safeAddress(host, isBlocked) {
  if (net.isIP(host)) return isBlocked(host) ? null : { address: host, family: net.isIPv6(host) ? 6 : 4 };
  const all = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (all.length === 0 || all.some((a) => isBlocked(a.address))) return null;
  return all[0];
}

function requestOnce(u, target, signal) {
  return new Promise((resolve) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'GET',
      servername: net.isIP(u.hostname) ? undefined : u.hostname,
      lookup: (_h, _o, cb) => cb(null, target.address, target.family),   // connect to the address we checked
      headers: { 'User-Agent': 'PreCheckdBot/1.0 (+https://precheckd.com)', Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
      signal
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ redirect: res.headers.location }); }
      const type = String(res.headers['content-type'] || '');
      if (status !== 200 || !/text\/html|application\/xhtml/i.test(type)) { res.resume(); return resolve(null); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { res.destroy(); return resolve(null); } chunks.push(c); });
      res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k] !== undefined) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10) || 32);
    return m;
  });
}

function htmlToPlain(html) {
  return decode(String(html)
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Job sites usually describe the job in JSON-LD (schema.org JobPosting): the cleanest source.
function fromJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { continue; }
    const items = [].concat(data, data && data['@graph'] ? data['@graph'] : []);
    for (const it of items) {
      if (it && /JobPosting/i.test([].concat(it['@type'] || []).join(' ')) && it.description) {
        const title = it.title ? `${it.title}\n\n` : '';
        const org = it.hiringOrganization && it.hiringOrganization.name ? `${it.hiringOrganization.name}\n` : '';
        // Some sites store the description as entity-escaped HTML.
        const raw = !/<[a-z]/i.test(it.description) && /&lt;/.test(it.description) ? decode(it.description) : it.description;
        return `${title}${org}${htmlToPlain(raw)}`.trim();
      }
    }
  }
  return null;
}

function extractPostingText(html) {
  const text = fromJsonLd(html) || htmlToPlain(html);
  return text.length >= 80 ? text.slice(0, MAX_CHARS) : null;
}

async function fetchWith(rawUrl, { isBlocked = isBlockedAddress } = {}) {
  try {
    let u = new URL(rawUrl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if (!checkUrl(u)) return null;
        const target = await safeAddress(u.hostname, isBlocked);
        if (!target) return null;
        const out = await requestOnce(u, target, ctrl.signal);
        if (!out) return null;
        if (out.html !== undefined) return extractPostingText(out.html);
        u = new URL(out.redirect, u);
      }
      return null;
    } finally { clearTimeout(timer); }
  } catch (e) { return null; }
}

const fetchPosting = (url) => fetchWith(url);

module.exports = { fetchPosting, fetchWith, isBlockedAddress, extractPostingText, htmlToPlain };
