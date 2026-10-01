// One-time migration script: emails every existing recruiter and candidate
// that predates password-based login a "set your password" link.
//
// Safe to re-run — only targets accounts where passwordHash is still null,
// so anyone who already set a password is skipped automatically. Accounts
// that already have an unexpired loginToken (e.g. they just requested their
// own reset) are also skipped so this doesn't stomp a link they're mid-use on.
//
// Usage: node scripts/send-password-migration-emails.js [--dry-run]

require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const { sendPasswordResetEmail, generateVerificationToken } = require('../src/services/emailService');

const DRY_RUN = process.argv.includes('--dry-run');
// Longer-lived than the normal 30-minute forgot-password window — this is a
// one-time, unprompted email, so recipients need more than half an hour to
// get around to opening it.
const MIGRATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function migrateCollection(Model, label) {
  const accounts = await Model.find({
    passwordHash: null,
    $or: [{ loginToken: null }, { loginTokenExpires: { $lte: new Date() } }],
  });

  console.log(`${label}: ${accounts.length} account(s) need a set-password email.`);

  for (const account of accounts) {
    if (DRY_RUN) {
      console.log(`  [dry run] would email ${account.email}`);
      continue;
    }

    const token = generateVerificationToken();
    account.loginToken = token;
    account.loginTokenExpires = Date.now() + MIGRATION_TOKEN_TTL_MS;
    await account.save();

    try {
      await sendPasswordResetEmail(account.email, account.firstName, token, { isFirstTime: true });
      console.log(`  sent -> ${account.email}`);
    } catch (err) {
      console.error(`  FAILED -> ${account.email}:`, err.message);
    }
  }
}

async function main() {
  await connectDatabase();

  if (DRY_RUN) {
    console.log('--- DRY RUN: no emails will be sent, no documents will be modified ---');
  }

  await migrateCollection(Recruiter, 'Recruiters');
  await migrateCollection(Candidate, 'Candidates');

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
