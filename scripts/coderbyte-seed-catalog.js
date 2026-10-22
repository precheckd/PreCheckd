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
const skillsService = require('../src/services/skills');

// A skill is tested as a ladder of three short tests built in CoderByte, one per tier, each registered
// as its own row with `tier` set and just that one skill. Candidates start on Basic ('easy'); passing a tier
// unlocks the next ('medium', then 'hard'). Every question counts as the row's tier, so no difficulty
// tagging step is needed. Example:
//   { assessmentId: '<id>', name: 'Agile: Basic', tier: 'easy', skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }] },
//   { assessmentId: '<id>', name: 'Agile: Intermediate', tier: 'medium', skills: [ ...same skill... ] },
//   { assessmentId: '<id>', name: 'Agile: Advanced', tier: 'hard', skills: [ ...same skill... ] },
const SEED = [
  {
    assessmentId: 'technical-assessment-9byeoyqm0d',
    name: 'Test: Linux, Agile, Cloud',
    kind: 'title', // a premade role-style mix, not our controlled 3/3/3 skill module
    skills: [
      { key: 'linux', label: 'Linux', ratingKeys: ['Linux', 'Unix'] },
      { key: 'agile', label: 'Agile', ratingKeys: ['Agile'] },
      { key: 'cloud', label: 'Cloud', ratingKeys: ['AWS'] }
    ]
  },
  {
    assessmentId: 'technical-assessment-vfz8sshskk',
    name: 'Agile: Basic',
    tier: 'easy',
    skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }]
  },
  {
    assessmentId: 'technical-assessment-ri47ell',
    name: 'Agile: Intermediate',
    tier: 'medium',
    skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }]
  },
  {
    assessmentId: 'technical-assessment-mf0xyfm',
    name: 'Agile: Advanced',
    tier: 'hard',
    skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }]
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
      console.log(`${apply ? 'UPSERT' : 'would upsert'} ${row.assessmentId} -> ${row.skills.map((s) => s.label).join(', ')} [${row.kind || 'skill'}${row.tier ? ', ' + row.tier + ' tier' : ''}]`);
      if (apply) {
        await SkillAssessment.findOneAndUpdate(
          { assessmentId: row.assessmentId },
          { $set: { name: row.name, kind: row.kind || 'skill', tier: row.tier || null, publicUrl: a.public_url, skills: row.skills, active: true } },
          { upsert: true }
        );
        // Candidates waiting on a skill are told once its first rung (or a combined test) is live.
        if ((row.kind || 'skill') === 'skill' && (!row.tier || row.tier === 'easy')) {
          const n = await skillsService.fulfillRequests(row.skills.map((x) => x.label));
          if (n) console.log(`  marked ${n} candidate request(s) ready and notified them`);
        }
      }
    }
    if (!apply) console.log('Run with --apply to save.');
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
