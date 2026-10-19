// Registers CoderByte assessments in our catalog (SkillAssessment) and maps their
// rating names to our skills. Run after building an assessment in their dashboard.
// Preview:  node scripts/coderbyte-seed-catalog.js         Apply:  ... --apply
//
// Edit SEED below. ratingKeys must match the names in the report's
// `skill_ratings` (see scripts/coderbyte-probe.js).
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const SkillAssessment = require('../src/models/SkillAssessment');
const coderbyte = require('../src/services/coderbyte');

const SEED = [
  {
    assessmentId: 'technical-assessment-9byeoyqm0d',
    name: 'Test: Linux, Agile, Cloud',
    skills: [
      { key: 'linux', label: 'Linux', ratingKeys: ['Linux', 'Unix'] },
      { key: 'agile', label: 'Agile', ratingKeys: ['Agile'] },
      { key: 'cloud', label: 'Cloud', ratingKeys: ['AWS'] }
    ]
  }
];

const apply = process.argv.includes('--apply');

connectDatabase()
  .then(async () => {
    const live = await coderbyte.api('GET', '/assessments');
    const byId = new Map(live.data.assessments.map((a) => [a.test_id, a]));
    for (const row of SEED) {
      const a = byId.get(row.assessmentId);
      if (!a) { console.log(`SKIP ${row.assessmentId}: not found in CoderByte`); continue; }
      console.log(`${apply ? 'UPSERT' : 'would upsert'} ${row.assessmentId} -> ${row.skills.map((s) => s.label).join(', ')}`);
      if (apply) {
        await SkillAssessment.findOneAndUpdate(
          { assessmentId: row.assessmentId },
          { $set: { name: row.name, publicUrl: a.public_url, skills: row.skills, active: true } },
          { upsert: true }
        );
      }
    }
    if (!apply) console.log('Run with --apply to save.');
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
