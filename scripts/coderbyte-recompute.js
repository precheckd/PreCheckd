// Re-derives skill levels (and the integrity hold) for stored attempts from the answers we already
// hold. No CoderByte calls. Run after changing the level rules or after tagging question difficulty
// (scripts/coderbyte-tag-difficulty.js), so older attempts pick up the new data.
// Preview by default; add --apply to save.
//   node scripts/coderbyte-recompute.js [--apply]
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const SkillAssessment = require('../src/models/SkillAssessment');
const SkillResult = require('../src/models/SkillResult');
const coderbyte = require('../src/services/coderbyte');

const apply = process.argv.includes('--apply');

connectDatabase()
  .then(async () => {
    const results = await SkillResult.find({ status: 'completed' });
    let changed = 0;
    for (const r of results) {
      const assessment = await SkillAssessment.findOne({ assessmentId: r.assessmentId });
      if (!assessment) { console.log(`${r.inviteRef}: no catalog entry, skipped`); continue; }
      const before = (r.skills || []).map((s) => `${s.label}=${s.level}`).join(', ');
      const skills = coderbyte.computeSkills(assessment, r.ratings || [], r.answers || []);
      const held = coderbyte.isFlagged(r.cheatingFlag) || !!r.aiUsage;
      const after = skills.map((s) => `${s.label}=${s.level}`).join(', ');
      const diff = before !== after || r.held !== held;
      console.log(`${diff ? '*' : ' '} ${r.inviteRef}  ${before || '(none)'}  ->  ${after}${r.held !== held ? `  [held: ${r.held} -> ${held}]` : ''}`);
      if (diff) changed++;
      if (apply && diff) { r.skills = skills; r.held = held; await r.save(); }
    }
    console.log(`\n${changed} of ${results.length} attempt(s) ${apply ? 'updated' : 'would change. Run again with --apply to save.'}`);
    process.exit(0);
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
