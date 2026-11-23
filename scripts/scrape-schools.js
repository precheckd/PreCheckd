#!/usr/bin/env node
// Builds the school directory CSV by reading each school's public registrar pages.
//
//   node scripts/scrape-schools.js --input hd2023.csv --out schools.csv [--test 20] [--limit 300] [--concurrency 8] [--max-usd 150]
//
//   --input        the IPEDS directory file (columns UNITID, INSTNM, WEBADDR; DEGGRANT and an enrollment column are used if present)
//   --out          the CSV to write (opens in Excel). Progress is saved next to it as <out>.progress.jsonl, so if the run is
//                  interrupted, run the same command again and it carries on where it stopped.
//   --test N       only the first N schools (a quick check before the real run)
//   --limit N      only the N biggest schools (uses an enrollment column, or the INSTSIZE size band in the IPEDS file)
//   --max-usd N    stop before spending more than about N dollars on the model (default 150)
// Needs ANTHROPIC_API_KEY in the environment. Keep the computer awake while it runs.
const fs = require('fs');
const csv = require('../src/utils/csv');
const scrape = require('../src/services/schoolScrape');
const { run } = require('../src/services/schoolScrapeRun');

const MODEL = process.env.SCRAPE_MODEL || 'claude-haiku-4-5-20251001';
const PRICE_IN = parseFloat(process.env.SCRAPE_PRICE_IN_PER_MTOK || '1');
const PRICE_OUT = parseFloat(process.env.SCRAPE_PRICE_OUT_PER_MTOK || '5');
const COLUMNS = ['name', 'ipedsId', 'website', 'registrarEmail', 'registrarPhone', 'sourceUrl', 'clearinghouseOnly', 'notes'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function args(argv) {
  const a = { concurrency: 8, maxUsd: 150 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--input') a.input = argv[++i]; else if (k === '--out') a.out = argv[++i];
    else if (k === '--test') a.test = parseInt(argv[++i], 10); else if (k === '--limit') a.limit = parseInt(argv[++i], 10);
    else if (k === '--concurrency') a.concurrency = parseInt(argv[++i], 10); else if (k === '--max-usd') a.maxUsd = parseFloat(argv[++i]);
  }
  return a;
}

const pick = (r, names) => { for (const n of names) if (r[n] !== undefined && r[n] !== '') return r[n]; return ''; };
function loadSchools(file) {
  let rows = csv.parse(fs.readFileSync(file, 'utf8')).map((r) => ({
    ipedsId: pick(r, ['UNITID', 'ipedsId']), name: pick(r, ['INSTNM', 'name']), website: pick(r, ['WEBADDR', 'website']),
    degreeGranting: pick(r, ['DEGGRANT']), enrollment: Math.max(0, parseInt(pick(r, ['enrollment', 'EFYTOTLT', 'EFTOTLT', 'ENRTOT', 'INSTSIZE']), 10) || 0), // INSTSIZE (1 to 5) is the size band in the IPEDS directory file
  })).filter((s) => s.name && s.website);
  if (rows.some((s) => s.degreeGranting)) rows = rows.filter((s) => s.degreeGranting === '1');
  if (rows.some((s) => s.enrollment)) rows.sort((a, b) => b.enrollment - a.enrollment);
  return rows;
}

// One request per host at a time, at least gapMs apart.
function pacer(gapMs) {
  const next = new Map();
  return async (host) => { const t = Math.max(Date.now(), next.get(host) || 0); next.set(host, t + gapMs); if (t > Date.now()) await sleep(t - Date.now()); };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.input || !a.out) { console.error('Usage: node scripts/scrape-schools.js --input hd2023.csv --out schools.csv [--test 20] [--limit 300]'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY first.'); process.exit(1); }
  let schools = loadSchools(a.input);
  if (a.limit) schools = schools.slice(0, a.limit);
  if (a.test) schools = schools.slice(0, a.test);

  const wait = pacer(1500);
  const robotsCache = new Map();
  const fetchPage = async (url) => {
    const u = new URL(url); await wait(u.host);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': scrape.USER_AGENT, Accept: 'text/html' } });
      if (!res.ok) return { ok: false, status: String(res.status) };
      if (!/html/i.test(res.headers.get('content-type') || '')) return { ok: false, status: 'not a web page' };
      return { ok: true, html: (await res.text()).slice(0, 600000), url: res.url };
    } catch (e) { return { ok: false, status: e && e.name === 'AbortError' ? 'timed out' : 'connection failed' }; } finally { clearTimeout(t); }
  };
  const robotsFor = async (origin) => {
    if (!robotsCache.has(origin)) {
      const p = fetchPage(origin + '/robots.txt').then((r) => scrape.parseRobots(r.ok ? r.html : '')).catch(() => scrape.parseRobots(''));
      robotsCache.set(origin, p);
    }
    return robotsCache.get(origin);
  };

  const callModel = async (system, user) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 400, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(Math.min(60000, (parseInt(res.headers.get('retry-after'), 10) || 2 ** attempt * 2) * 1000)); continue; }
      if (!res.ok) throw new Error(`model error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return { text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), usage: data.usage };
    }
    throw new Error('model busy: gave up after retries');
  };

  process.on('SIGINT', () => { console.log('\nStopping and saving...'); runner.stop(); });
  const runner = run({ schools, out: a.out, concurrency: a.concurrency, maxUsd: a.maxUsd, priceIn: PRICE_IN, priceOut: PRICE_OUT, deps: { fetchPage, robotsFor, callModel }, log: console.log });
  await runner.done;
}

main().catch((e) => { console.error(e); process.exit(1); });
