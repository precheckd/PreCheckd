// Read-only: shows a candidate's skill-assessment attempts as stored in OUR database.
// Makes no CoderByte API call, so it shows exactly what the webhooks did on their own.
// Usage: node scripts/coderbyte-status.js <candidateEmail>
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const SkillResult = require('../src/models/SkillResult');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/coderbyte-status.js <candidateEmail>');
  process.exit(1);
}

connectDatabase()
  .then(async () => {
    const candidate = await Candidate.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!candidate) throw new Error(`No candidate with email ${email}`);
    const rows = await SkillResult.find({ candidateId: candidate._id }).sort({ createdAt: -1 }).limit(8);
    if (!rows.length) console.log('No attempts yet.');
    for (const r of rows) {
      console.log(`\n${r.inviteRef}  status=${r.status}  invited=${r.invitedAt ? r.invitedAt.toISOString() : '-'}`
        + `  started=${r.startedAt ? r.startedAt.toISOString() : '-'}  completed=${r.completedAt ? r.completedAt.toISOString() : '-'}`);
      if (r.status === 'completed') {
        console.log(`  overall=${r.overallScore}  minutes=${r.timeTakenMinutes}  cheating=${r.cheatingFlag}`);
        console.log('  skills: ' + r.skills.map((s) => `${s.label} ${s.score} (${s.level}${s.weighted ? ', weighted' : ''})`).join(' | '));
      }
      if (r.lastError) console.log(`  lastError: ${r.lastError}`);
    }
    process.exit(0);
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
