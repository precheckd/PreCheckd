// One-off: gives every existing candidate and every real (non-claim) recruiter
// a PreCheckd mail alias. Safe to re-run; accounts that already have one are
// skipped. Run on the host with:  npm run assign-mail-aliases
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const Recruiter = require('../src/models/Recruiter');
const { ensureMailAlias, addressFor } = require('../src/utils/mailAlias');

connectDatabase()
  .then(async () => {
    const candidates = await Candidate.find({});
    // Claim accounts are placeholders built from a reported email, not people.
    const recruiters = await Recruiter.find({ accountTier: { $ne: 'unverified_claim' }, lastName: { $ne: null } });

    let made = 0;
    for (const [namespace, owners] of [['candidate', candidates], ['recruiter', recruiters]]) {
      for (const owner of owners) {
        const row = await ensureMailAlias(namespace, owner);
        if (row.createdAt && Date.now() - row.createdAt.getTime() < 60 * 1000) made += 1;
        console.log(`${namespace.padEnd(9)} ${owner.slug} -> ${addressFor(namespace, row.alias)}`);
      }
    }
    console.log(`Done. ${made} new alias(es); ${candidates.length} candidates and ${recruiters.length} recruiters checked.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Alias backfill failed:', err);
    process.exit(1);
  });
