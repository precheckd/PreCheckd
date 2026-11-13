// TEST ACCOUNTS ONLY. Gives a candidate a skill level without taking the tests, so you can try job applications.
// Writes real-looking completed results for the Basic and Intermediate rungs (all answers right), marked
// inviteRef "manual-grant-...". Preview by default; add --apply to write.
// Usage: node scripts/grant-test-skill.js <candidateEmail> <skillKey> [--apply]     e.g. kentmayer123@gmail.com azure --apply
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const SkillAssessment = require('../src/models/SkillAssessment');
const SkillResult = require('../src/models/SkillResult');

const [email, skillKey] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!email || !skillKey) { console.error('Usage: node scripts/grant-test-skill.js <candidateEmail> <skillKey> [--apply]'); process.exit(1); }

connectDatabase()
  .then(async () => {
    const candidate = await Candidate.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!candidate) throw new Error(`No candidate with email ${email}`);
    const rungs = await SkillAssessment.find({ active: true, tier: { $in: ['easy', 'medium'] }, 'skills.key': skillKey });
    if (rungs.length < 2) throw new Error(`Need both the Basic and Intermediate tests for "${skillKey}"; found ${rungs.length}`);
    for (const a of rungs) {
      const s = a.skills[0];
      console.log(`${apply ? 'GRANT' : 'would grant'} ${a.name} (${a.tier}) to ${candidate.email}`);
      if (!apply) continue;
      const ref = `manual-grant-${candidate._id}-${a.assessmentId}`;
      await SkillResult.findOneAndUpdate({ inviteRef: ref }, { $set: {
        candidateId: candidate._id, assessmentId: a.assessmentId, inviteRef: ref, status: 'completed',
        invitedAt: new Date(), startedAt: new Date(), completedAt: new Date(), overallScore: 100, held: false,
        skills: [{ key: s.key, label: s.label, score: 100, weighted: true, level: null, tiers: { [a.tier]: { right: 10, total: 10 } } }]
      } }, { upsert: true });
    }
    if (apply) { await require('../src/services/skills').refreshSkillSummary(candidate); console.log('Done. Check the Skills page.'); }
    process.exit(0);
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
