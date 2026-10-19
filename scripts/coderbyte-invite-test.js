// Sends ONE real invite (skip_send, our own ID instead of an email) to a candidate
// and prints CoderByte's raw response, since the invite response format isn't
// documented. Deliberate, not automatic: this may use an invite credit.
// Usage: node scripts/coderbyte-invite-test.js <candidateEmail> <assessmentId>
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const SkillAssessment = require('../src/models/SkillAssessment');
const coderbyte = require('../src/services/coderbyte');

const [candidateEmail, assessmentId] = process.argv.slice(2);
if (!candidateEmail || !assessmentId) {
  console.error('Usage: node scripts/coderbyte-invite-test.js <candidateEmail> <assessmentId>');
  process.exit(1);
}

connectDatabase()
  .then(async () => {
    const candidate = await Candidate.findOne({ email: new RegExp(`^${candidateEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!candidate) throw new Error(`No candidate with email ${candidateEmail}`);
    const assessment = await SkillAssessment.findOne({ assessmentId });
    if (!assessment) throw new Error('Not in the catalog yet: run scripts/coderbyte-seed-catalog.js --apply');
    const result = await coderbyte.inviteCandidate({ candidate, assessment, debug: true });
    console.log(`\ninviteRef: ${result.inviteRef}\ninviteUrl: ${result.inviteUrl}\nexpires:   ${result.expiresAt.toISOString()}`);
    process.exit(0);
  })
  .catch((e) => { console.error(e.message, e.body ? JSON.stringify(e.body) : ''); process.exit(1); });
