// Runs the scraper over a list of schools: a small worker pool, a saved progress file (so an interrupted run resumes),
// a spending limit, and the final CSV. The web fetcher and the model are passed in (see scripts/scrape-schools.js).
const fs = require('fs');
const csv = require('../utils/csv');
const scrape = require('./schoolScrape');

const COLUMNS = ['name', 'ipedsId', 'website', 'registrarEmail', 'registrarPhone', 'sourceUrl', 'clearinghouseOnly', 'notes'];
const keyOf = (s) => s.ipedsId || s.name;

function run({ schools, out, concurrency = 8, maxUsd = 150, priceIn = 1, priceOut = 5, deps, log = () => {} }) {
  const progressFile = out + '.progress.jsonl';
  const done = new Map();
  if (fs.existsSync(progressFile)) {
    for (const l of fs.readFileSync(progressFile, 'utf8').split('\n')) { if (l.trim()) { try { const j = JSON.parse(l); done.set(j.row.ipedsId || j.row.name, j); } catch (e) { /* skip a damaged line */ } } }
  }
  const queue = schools.filter((s) => !done.has(keyOf(s)));
  log(`${schools.length} schools selected, ${schools.length - queue.length} already done, ${queue.length} to do.`);
  let spent = 0; let stopped = false; let n = 0; const started = Date.now();

  const worker = async () => {
    while (queue.length && !stopped) {
      if (spent >= maxUsd) { log(`Reached the $${maxUsd} limit; stopping. Run the same command again to continue.`); stopped = true; break; }
      const school = queue.shift();
      let result; let transient = false;
      try { result = await scrape.scrapeSchool(school, deps); }
      catch (e) { transient = true; result = { row: { name: school.name, ipedsId: school.ipedsId, website: school.website, registrarEmail: '', registrarPhone: '', sourceUrl: '', clearinghouseOnly: '', notes: 'error: ' + String(e.message).slice(0, 80) }, tally: { inTokens: 0, outTokens: 0 }, error: e.message }; }
      spent += (result.tally.inTokens * priceIn + result.tally.outTokens * priceOut) / 1e6;
      done.set(keyOf(school), result);
      // A crash (model busy, network) is not saved as progress, so running again retries that school.
      if (!transient) fs.appendFileSync(progressFile, JSON.stringify({ row: result.row, error: result.error }) + '\n');
      n += 1;
      if (n % 10 === 0 || !queue.length) {
        const found = [...done.values()].filter((j) => j.row.registrarEmail).length;
        log(`${done.size}/${schools.length} done | emails found: ${found} | about $${spent.toFixed(2)} spent | ${Math.round((Date.now() - started) / 60000)} min`);
      }
    }
  };

  const finish = async () => {
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    const rows = schools.map((s) => done.get(keyOf(s))).filter(Boolean).map((j) => j.row);
    fs.writeFileSync(out, csv.stringify(rows, COLUMNS));
    log(`Saved ${rows.length} rows to ${out}. Emails: ${rows.filter((r) => r.registrarEmail).length}, uses Clearinghouse: ${rows.filter((r) => r.clearinghouseOnly).length}, need research: ${rows.filter((r) => !r.registrarEmail).length}.`);
    return { rows, spent };
  };
  return { done: finish(), stop() { stopped = true; } };
}

module.exports = { run, COLUMNS };
