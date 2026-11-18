// Nightly reset of the demo site: wipes the demo database and loads fresh sample data.
// Run by a Render cron job:  npm run demo:reset   (needs DEMO_MODE=true and MONGODB_DB_NAME containing "demo").
require('dotenv').config();
require('../src/config/demo').lockDown();
const { connectDatabase } = require('../src/config/database');
const { run, assertDemoDatabase } = require('../src/demo/seed');

(async () => {
  assertDemoDatabase(process.env.MONGODB_DB_NAME);
  await connectDatabase();
  const counts = await run();
  console.log('[demo] reset done', JSON.stringify(counts));
  process.exit(0);
})().catch((err) => { console.error('[demo] reset failed:', err.message); process.exit(1); });
