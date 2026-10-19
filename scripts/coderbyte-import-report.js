// Imports an EXISTING CoderByte report onto a candidate, to test ingestion end to end.
// Usage: node scripts/coderbyte-import-report.js <candidateEmail> <emailUsedOnInvite> <assessmentId>
// (For a self-test, the last two are the email you took the test with and the test_id.)
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const SkillResult = require('../src/models/SkillResult');
const coderbyte = require('../src/services/coderbyte');

const [candidateEmail, ref, assessmentId] = process.argv.slice(2);
if (!candidateEmail || !ref || !assessmentId) {
  console.error('Usage: node scripts/coderbyte-import-report.js <candidateEmail> <emailUsedOnInvite> <assessmentId>');
  process.exit(1);
}

connectDatabase()
  .then(async () => {
    const candidate = await Candidate.findOne({ email: new RegExp(`^${candidateEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!candidate) throw new Error(`No candidate with email ${candidateEmail}`);
    let result = await SkillResult.findOne({ inviteRef: ref });
    if (!result) {
      result = await SkillResult.create({ candidateId: candidate._id, assessmentId, inviteRef: ref, status: 'started', invitedAt: new Date() });
    }
    await coderbyte.syncResult(result);
    console.log(JSON.stringify({
      status: result.status, overallScore: result.overallScore, minutes: result.timeTakenMinutes,
      cheating: result.cheatingFlag, ratings: result.ratings, skills: result.skills
    }, null, 2));
    process.exit(0);
  })
  .catch((e) => { console.error(e.message, e.body || ''); process.exit(1); });
