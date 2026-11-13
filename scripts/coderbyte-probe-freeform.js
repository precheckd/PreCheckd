// Read-only. Shows whether CoderByte's report API includes the written (free-form) answers, and what else it holds.
// Prints the report's field names and, for anything that looks like free-form, the first 120 characters. Stores nothing.
// Usage: node scripts/coderbyte-probe-freeform.js <inviteRef> <assessmentId>
//   e.g. node scripts/coderbyte-probe-freeform.js pc_d504137cd21f64bdf6 software-engineer-r6fiquec3e
require('dotenv').config();
const coderbyte = require('../src/services/coderbyte');
const [ref, assessmentId] = process.argv.slice(2);
if (!ref || !assessmentId) { console.error('Usage: node scripts/coderbyte-probe-freeform.js <inviteRef> <assessmentId>'); process.exit(1); }

const id = ref.startsWith('pc_') ? coderbyte.deriveCoderbyteId(ref) : ref;
coderbyte.api('GET', `/candidates/${encodeURIComponent(id)}/${encodeURIComponent(assessmentId)}`)
  .then((body) => {
    const reports = (body && body.data && body.data.reports) || [];
    console.log(`reports: ${reports.length}`);
    for (const r of reports) {
      console.log('\nTOP-LEVEL FIELDS:', Object.keys(r).join(', '));
      const walk = (v, path) => {
        if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k); return; }
        if (/free|open|essay|text|answer|response|comment|url|link/i.test(path)) console.log(`  ${path} = ${String(v).slice(0, 120)}`);
      };
      walk(r, '');
    }
    process.exit(0);
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
