// Records question difficulty for an assessment, since CoderByte's API doesn't expose it.
//
// The library labels whole SETS Easy/Medium/Hard, and the details endpoint lists every
// question in the assessment with its id. So build the assessment one tier at a time:
//   1. add the Easy sets in the CoderByte dashboard   -> node scripts/coderbyte-tag-difficulty.js <assessmentId> easy
//   2. add the Medium sets                            -> ... <assessmentId> medium
//   3. add the Hard sets                              -> ... <assessmentId> hard
// Each run gives every question not yet recorded the difficulty you name, so earlier
// tiers are never overwritten. Preview by default; add --apply to save.
//
//   node scripts/coderbyte-tag-difficulty.js <assessmentId> --list      show what is recorded
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const SkillAssessment = require('../src/models/SkillAssessment');
const coderbyte = require('../src/services/coderbyte');

const [assessmentId, tier] = process.argv.slice(2);
const apply = process.argv.includes('--apply');
const TIERS = ['easy', 'medium', 'hard'];

if (!assessmentId || !(tier === '--list' || TIERS.includes(tier))) {
  console.error('Usage: node scripts/coderbyte-tag-difficulty.js <assessmentId> <easy|medium|hard|--list> [--apply]');
  process.exit(1);
}

connectDatabase()
  .then(async () => {
    const assessment = await SkillAssessment.findOne({ assessmentId });
    if (!assessment) throw new Error('Not in the catalog yet: run scripts/coderbyte-seed-catalog.js --apply');

    const details = await coderbyte.api('GET', `/assessments/details/${encodeURIComponent(assessmentId)}`);
    const live = (details.data.multiple_choice || []).map(([id, q]) => ({ id: String(id), tags: q.tags || [] }));
    const known = new Map(assessment.questions.map((q) => [q.id, q.difficulty]));

    if (tier === '--list') {
      const counts = {};
      for (const q of live) {
        const d = known.get(q.id) || 'UNMAPPED';
        for (const t of q.tags) { counts[t] = counts[t] || {}; counts[t][d] = (counts[t][d] || 0) + 1; }
      }
      console.log(`${live.length} questions in the assessment, ${live.filter((q) => known.has(q.id)).length} mapped.`);
      console.log(JSON.stringify(counts, null, 2));
      process.exit(0);
    }

    const fresh = live.filter((q) => !known.has(q.id));
    console.log(`${fresh.length} unmapped question(s) -> ${tier}:`);
    for (const q of fresh) console.log(`  ${q.id}  [${q.tags.join(', ')}]`);
    const gone = assessment.questions.filter((q) => !live.some((l) => l.id === q.id));
    if (gone.length) console.log(`(${gone.length} recorded question(s) are no longer in the assessment and will be dropped.)`);

    if (apply) {
      assessment.questions = [
        ...assessment.questions.filter((q) => live.some((l) => l.id === q.id)),
        ...fresh.map((q) => ({ id: q.id, difficulty: tier }))
      ];
      await assessment.save();
      console.log('Saved.');
    } else {
      console.log('Preview only. Run again with --apply to save.');
    }
    process.exit(0);
  })
  .catch((e) => { console.error(e.message, e.body ? JSON.stringify(e.body) : ''); process.exit(1); });
