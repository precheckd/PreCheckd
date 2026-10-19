// Creates ONE invite for a candidate: a no-PII link (public assessment link + our own ID)
// that you open to take the test. No API call is made, so nothing is sent or spent until
// the link is opened.
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
    const result = await coderbyte.inviteCandidate({ candidate, assessment });
    console.log(`\ninviteRef: ${result.inviteRef}\ninviteUrl: ${result.inviteUrl}\nexpires:   ${result.expiresAt.toISOString()}`);
    process.exit(0);
  })
  .catch((e) => { console.error(e.message, e.body ? JSON.stringify(e.body) : ''); process.exit(1); });
