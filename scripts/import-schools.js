// Usage: node scripts/import-schools.js schools.csv
// CSV columns (header row required): name, ipedsId, website, registrarEmail, registrarPhone, sourceUrl
// Run where the network is open (your computer or a Render shell): it checks each school's domain for mail (DNS).
const fs = require('fs');
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const mongoose = require('mongoose');
const { importRows } = require('../src/services/schoolImport');

function parseCsv(text) {
  const rows = []; let cur = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; cur.push(field); field = ''; if (cur.some((x) => x.trim())) rows.push(cur); cur = []; }
    else field += ch;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/import-schools.js schools.csv'); process.exit(1); }
  await connectDatabase();
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  console.log(`Importing ${rows.length} schools...`);
  console.log(await importRows(rows));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
