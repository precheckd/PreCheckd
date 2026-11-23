// Usage: node scripts/import-schools.js schools.csv
// CSV columns (header row required): name, ipedsId, website, registrarEmail, registrarPhone, sourceUrl, clearinghouseOnly, notes
// (the file written by scripts/scrape-schools.js has exactly these)
// Run where the network is open (your computer or a Render shell): it checks each school's domain for mail (DNS).
const fs = require('fs');
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const mongoose = require('mongoose');
const { importRows } = require('../src/services/schoolImport');
const csvUtil = require('../src/utils/csv');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/import-schools.js schools.csv'); process.exit(1); }
  await connectDatabase();
  const rows = csvUtil.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Importing ${rows.length} schools...`);
  console.log(await importRows(rows));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
