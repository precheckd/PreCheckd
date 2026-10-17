// One-off: turns ALL-CAPS names (copied from ID documents) into normal case for
// existing candidates and recruiters. Mixed-case names are never touched.
// Preview:  npm run fix-name-case          Apply:  npm run fix-name-case -- --apply
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const Recruiter = require('../src/models/Recruiter');
const { properName } = require('../src/utils/properName');

const apply = process.argv.includes('--apply');

connectDatabase()
  .then(async () => {
    let changed = 0;
    for (const [label, Model] of [['candidate', Candidate], ['recruiter', Recruiter]]) {
      const rows = await Model.find({}).select('firstName lastName');
      for (const r of rows) {
        const first = properName(r.firstName);
        const last = properName(r.lastName);
        if (first === r.firstName && last === r.lastName) continue;
        changed += 1;
        console.log(`${label}: ${r.firstName} ${r.lastName} -> ${first} ${last}`);
        if (apply) await Model.updateOne({ _id: r._id }, { $set: { firstName: first, lastName: last } });
      }
    }
    console.log(`${changed} name(s) ${apply ? 'updated' : 'would change (run with --apply)'}.`);
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
