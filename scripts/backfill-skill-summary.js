// Rebuilds the recruiter-search skill summary for every candidate who has completed a test. Run once
// after deploying skill search, and again any time the visibility or level rules change.
// Preview by default; add --apply to save.
//   node scripts/backfill-skill-summary.js [--apply]
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const SkillResult = require('../src/models/SkillResult');
const skills = require('../src/services/skills');

const apply = process.argv.includes('--apply');

connectDatabase()
  .then(async () => {
    const ids = await SkillResult.distinct('candidateId', { status: 'completed' });
    let withSkills = 0;
    for (const id of ids) {
      const c = await Candidate.findById(id);
      if (!c) continue;
      const hidden = new Set(c.hiddenSkillKeys || []);
      const shown = (await skills.currentSkills(c._id)).filter((s) => !hidden.has(s.key) && skills.SHOWABLE.has(s.level));
      console.log(`${c.slug}: ${shown.length ? shown.map((s) => `${s.label}=${s.level}`).join(', ') : '(nothing shown to recruiters)'}`);
      if (shown.length) withSkills++;
      if (apply) await skills.refreshSkillSummary(c);
    }
    console.log(`\n${ids.length} candidate(s) with results, ${withSkills} with skills shown. ${apply ? 'Saved.' : 'Preview only. Run again with --apply to save.'}`);
    process.exit(0);
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
