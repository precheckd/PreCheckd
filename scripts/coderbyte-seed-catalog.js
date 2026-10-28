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
    assessmentId: 'technical-assessment-82ti4w8',
    name: 'Network: Basic',
    tier: 'easy',
    skills: [{ key: 'network', label: 'Network', ratingKeys: ['Network'] }]
  },
  {
    assessmentId: 'technical-assessment-oytzqzu',
    name: 'Network: Intermediate',
    tier: 'medium',
    skills: [{ key: 'network', label: 'Network', ratingKeys: ['Network'] }]
  },
  {
    assessmentId: 'technical-assessment-u29p262',
    name: 'Network: Advanced',
    tier: 'hard',
    skills: [{ key: 'network', label: 'Network', ratingKeys: ['Network'] }]
  },
  {
    assessmentId: 'technical-assessment-b017abc',
    name: 'Network: Expert',
    tier: 'expert',
    skills: [{ key: 'network', label: 'Network', ratingKeys: ['Network'] }]
  },
  {
    assessmentId: 'technical-assessment-0x40woo',
    name: 'SQL: Basic',
    tier: 'easy',
    skills: [{ key: 'sql', label: 'SQL', ratingKeys: ['SQL'] }]
  },
  {
    assessmentId: 'technical-assessment-jz5xd3l',
    name: 'SQL: Intermediate',
    tier: 'medium',
    skills: [{ key: 'sql', label: 'SQL', ratingKeys: ['SQL'] }]
  },
  {
    assessmentId: 'technical-assessment-4vdkha6',
    name: 'SQL: Advanced',
    tier: 'hard',
    skills: [{ key: 'sql', label: 'SQL', ratingKeys: ['SQL'] }]
  },
  {
    assessmentId: 'technical-assessment-r711euy',
    name: 'SQL: Expert',
    tier: 'expert',
    skills: [{ key: 'sql', label: 'SQL', ratingKeys: ['SQL'] }]
  },
  {
    assessmentId: 'technical-assessment-pkzi1yc',
    name: 'Python: Basic',
    tier: 'easy',
    skills: [{ key: 'python', label: 'Python', ratingKeys: ['Python'] }]
  },
  {
    assessmentId: 'technical-assessment-dlyljrz',
    name: 'Python: Intermediate',
    tier: 'medium',
    skills: [{ key: 'python', label: 'Python', ratingKeys: ['Python'] }]
  },
  {
    assessmentId: 'technical-assessment-o4p899v',
    name: 'Python: Advanced',
    tier: 'hard',
    skills: [{ key: 'python', label: 'Python', ratingKeys: ['Python'] }]
  },
  {
    assessmentId: 'technical-assessment-6aqh6re',
    name: 'Python: Expert',
    tier: 'expert',
    skills: [{ key: 'python', label: 'Python', ratingKeys: ['Python'] }]
  },
  {
    assessmentId: 'technical-assessment-t7elkfy',
    name: 'Security: Basic',
    tier: 'easy',
    skills: [{ key: 'security', label: 'Security', ratingKeys: ['Security'] }]
  },
  {
    assessmentId: 'technical-assessment-3jm3y35',
    name: 'Security: Intermediate',
    tier: 'medium',
    skills: [{ key: 'security', label: 'Security', ratingKeys: ['Security'] }]
  },
  {
    assessmentId: 'technical-assessment-bn8xdif',
    name: 'Security: Advanced',
    tier: 'hard',
    skills: [{ key: 'security', label: 'Security', ratingKeys: ['Security'] }]
  },
  {
    assessmentId: 'technical-assessment-o3eyfis',
    name: 'Security: Expert',
    tier: 'expert',
    skills: [{ key: 'security', label: 'Security', ratingKeys: ['Security'] }]
  },
  {
    assessmentId: 'technical-assessment-hlf5brt',
    name: 'Cloud: Basic',
    tier: 'easy',
    skills: [{ key: 'cloud', label: 'Cloud', ratingKeys: ['Cloud'] }]
  },
  {
    assessmentId: 'technical-assessment-3zrn656',
    name: 'Cloud: Intermediate',
    tier: 'medium',
    skills: [{ key: 'cloud', label: 'Cloud', ratingKeys: ['Cloud'] }]
  },
  {
    assessmentId: 'technical-assessment-6yg49pw',
    name: 'Cloud: Advanced',
    tier: 'hard',
    skills: [{ key: 'cloud', label: 'Cloud', ratingKeys: ['Cloud'] }]
  },
  {
    assessmentId: 'technical-assessment-uqzd0bw',
    name: 'Cloud: Expert',
    tier: 'expert',
    skills: [{ key: 'cloud', label: 'Cloud', ratingKeys: ['Cloud'] }]
  },
  {
    assessmentId: 'technical-assessment-88wfjpk',
    name: 'Linux: Basic',
    tier: 'easy',
    skills: [{ key: 'linux', label: 'Linux', ratingKeys: ['Linux'] }]
  },
  {
    assessmentId: 'technical-assessment-2lszcnn',
    name: 'Linux: Intermediate',
    tier: 'medium',
    skills: [{ key: 'linux', label: 'Linux', ratingKeys: ['Linux'] }]
  },
  {
    assessmentId: 'technical-assessment-ylnvyaj',
    name: 'Linux: Advanced',
    tier: 'hard',
    skills: [{ key: 'linux', label: 'Linux', ratingKeys: ['Linux'] }]
  },
  {
    assessmentId: 'technical-assessment-yn2dxln',
    name: 'Linux: Expert',
    tier: 'expert',
    skills: [{ key: 'linux', label: 'Linux', ratingKeys: ['Linux'] }]
  },
  {
    assessmentId: 'technical-assessment-u8rah39',
    name: 'Agile: Basic',
    tier: 'easy',
    skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }]
  },
  {
    assessmentId: 'technical-assessment-1gz2z7y',
    name: 'Agile: Intermediate',
    tier: 'medium',
    skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }]
  },
  {
    assessmentId: 'technical-assessment-bnt2akf',
    name: 'Agile: Advanced',
    tier: 'hard',
    skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }]
  },
  {
    assessmentId: 'technical-assessment-nk94ll7',
    name: 'Agile: Expert',
    tier: 'expert',
    skills: [{ key: 'agile', label: 'Agile', ratingKeys: ['Agile'] }]
  },
  {
    assessmentId: 'technical-assessment-0wl8wfh',
    name: 'PowerShell: Basic',
    tier: 'easy',
    skills: [{ key: 'powershell', label: 'PowerShell', ratingKeys: ['PowerShell'] }]
  },
  {
    assessmentId: 'technical-assessment-zdw12v0',
    name: 'PowerShell: Intermediate',
    tier: 'medium',
    skills: [{ key: 'powershell', label: 'PowerShell', ratingKeys: ['PowerShell'] }]
  },
  {
    assessmentId: 'technical-assessment-p8v7v2i',
    name: 'PowerShell: Advanced',
    tier: 'hard',
    skills: [{ key: 'powershell', label: 'PowerShell', ratingKeys: ['PowerShell'] }]
  },
  {
    assessmentId: 'technical-assessment-sqphu5c',
    name: 'PowerShell: Expert',
    tier: 'expert',
    skills: [{ key: 'powershell', label: 'PowerShell', ratingKeys: ['PowerShell'] }]
  },
  {
    assessmentId: 'technical-assessment-dkofxhz',
    name: 'Jira: Basic',
    tier: 'easy',
    skills: [{ key: 'jira', label: 'Jira', ratingKeys: ['Jira'] }]
  },
  {
    assessmentId: 'technical-assessment-cul4ian',
    name: 'Jira: Intermediate',
    tier: 'medium',
    skills: [{ key: 'jira', label: 'Jira', ratingKeys: ['Jira'] }]
  },
  {
    assessmentId: 'technical-assessment-xuzt8g0',
    name: 'Jira: Advanced',
    tier: 'hard',
    skills: [{ key: 'jira', label: 'Jira', ratingKeys: ['Jira'] }]
  },
  {
    assessmentId: 'technical-assessment-4jiidpa',
    name: 'Jira: Expert',
    tier: 'expert',
    skills: [{ key: 'jira', label: 'Jira', ratingKeys: ['Jira'] }]
  },
  {
    assessmentId: 'technical-assessment-0mby6et',
    name: 'Active Directory: Basic',
    tier: 'easy',
    skills: [{ key: 'active-directory', label: 'Active Directory', ratingKeys: ['Active Directory'] }]
  },
  {
    assessmentId: 'technical-assessment-9rsod5r',
    name: 'Active Directory: Intermediate',
    tier: 'medium',
    skills: [{ key: 'active-directory', label: 'Active Directory', ratingKeys: ['Active Directory'] }]
  },
  {
    assessmentId: 'technical-assessment-g57lixs',
    name: 'Active Directory: Advanced',
    tier: 'hard',
    skills: [{ key: 'active-directory', label: 'Active Directory', ratingKeys: ['Active Directory'] }]
  },
  {
    assessmentId: 'technical-assessment-siyutsu',
    name: 'Active Directory: Expert',
    tier: 'expert',
    skills: [{ key: 'active-directory', label: 'Active Directory', ratingKeys: ['Active Directory'] }]
  },
  {
    assessmentId: 'technical-assessment-p7inui2',
    name: 'Customer Support: Basic',
    tier: 'easy',
    skills: [{ key: 'customer-support', label: 'Customer Support', ratingKeys: ['Customer Support'] }]
  },
  {
    assessmentId: 'technical-assessment-d2zmjk1',
    name: 'Customer Support: Intermediate',
    tier: 'medium',
    skills: [{ key: 'customer-support', label: 'Customer Support', ratingKeys: ['Customer Support'] }]
  },
  {
    assessmentId: 'technical-assessment-kwzkunl',
    name: 'Customer Support: Advanced',
    tier: 'hard',
    skills: [{ key: 'customer-support', label: 'Customer Support', ratingKeys: ['Customer Support'] }]
  },
  {
    assessmentId: 'technical-assessment-5dbhtcr',
    name: 'Customer Support: Expert',
    tier: 'expert',
    skills: [{ key: 'customer-support', label: 'Customer Support', ratingKeys: ['Customer Support'] }]
  },
  {
    assessmentId: 'technical-assessment-ektbofg',
    name: 'English Proficiency: Basic',
    tier: 'easy',
    skills: [{ key: 'english-proficiency', label: 'English Proficiency', ratingKeys: ['English Proficiency'] }]
  },
  {
    assessmentId: 'technical-assessment-ejh159m',
    name: 'English Proficiency: Intermediate',
    tier: 'medium',
    skills: [{ key: 'english-proficiency', label: 'English Proficiency', ratingKeys: ['English Proficiency'] }]
  },
  {
    assessmentId: 'technical-assessment-y14zzyy',
    name: 'English Proficiency: Advanced',
    tier: 'hard',
    skills: [{ key: 'english-proficiency', label: 'English Proficiency', ratingKeys: ['English Proficiency'] }]
  },
  {
    assessmentId: 'technical-assessment-31uhja1',
    name: 'English Proficiency: Expert',
    tier: 'expert',
    skills: [{ key: 'english-proficiency', label: 'English Proficiency', ratingKeys: ['English Proficiency'] }]
  },
  {
    assessmentId: 'technical-assessment-2okifvd',
    name: 'Problem Solving: Basic',
    tier: 'easy',
    skills: [{ key: 'problem-solving', label: 'Problem Solving', ratingKeys: ['Problem Solving'] }]
  },
  {
    assessmentId: 'technical-assessment-upwq853',
    name: 'Problem Solving: Intermediate',
    tier: 'medium',
    skills: [{ key: 'problem-solving', label: 'Problem Solving', ratingKeys: ['Problem Solving'] }]
  },
  {
    assessmentId: 'technical-assessment-dlh4z51',
    name: 'Problem Solving: Advanced',
    tier: 'hard',
    skills: [{ key: 'problem-solving', label: 'Problem Solving', ratingKeys: ['Problem Solving'] }]
  },
  {
    assessmentId: 'technical-assessment-flcfhi7',
    name: 'Problem Solving: Expert',
    tier: 'expert',
    skills: [{ key: 'problem-solving', label: 'Problem Solving', ratingKeys: ['Problem Solving'] }]
  },
  {
    assessmentId: 'technical-assessment-cw8vo4k',
    name: 'Customer Success: Basic',
    tier: 'easy',
    skills: [{ key: 'customer-success', label: 'Customer Success', ratingKeys: ['Customer Success'] }]
  },
  {
    assessmentId: 'technical-assessment-2blrjtu',
    name: 'Customer Success: Intermediate',
    tier: 'medium',
    skills: [{ key: 'customer-success', label: 'Customer Success', ratingKeys: ['Customer Success'] }]
  },
  {
    assessmentId: 'technical-assessment-w2fvml2',
    name: 'Customer Success: Advanced',
    tier: 'hard',
    skills: [{ key: 'customer-success', label: 'Customer Success', ratingKeys: ['Customer Success'] }]
  },
  {
    assessmentId: 'technical-assessment-ohq8qgu',
    name: 'Customer Success: Expert',
    tier: 'expert',
    skills: [{ key: 'customer-success', label: 'Customer Success', ratingKeys: ['Customer Success'] }]
  },
  {
    assessmentId: 'technical-assessment-h7g8qwk',
    name: 'ServiceNow: Basic',
    tier: 'easy',
    skills: [{ key: 'servicenow', label: 'ServiceNow', ratingKeys: ['ServiceNow'] }]
  },
  {
    assessmentId: 'technical-assessment-2n5ljnf',
    name: 'ServiceNow: Intermediate',
    tier: 'medium',
    skills: [{ key: 'servicenow', label: 'ServiceNow', ratingKeys: ['ServiceNow'] }]
  },
  {
    assessmentId: 'technical-assessment-7zi6ftr',
    name: 'ServiceNow: Advanced',
    tier: 'hard',
    skills: [{ key: 'servicenow', label: 'ServiceNow', ratingKeys: ['ServiceNow'] }]
  },
  {
    assessmentId: 'technical-assessment-wevlgty',
    name: 'ServiceNow: Expert',
    tier: 'expert',
    skills: [{ key: 'servicenow', label: 'ServiceNow', ratingKeys: ['ServiceNow'] }]
  },
  {
    assessmentId: 'technical-assessment-kxlezb8',
    name: 'Cybersecurity: Basic',
    tier: 'easy',
    skills: [{ key: 'cybersecurity', label: 'Cybersecurity', ratingKeys: ['Cybersecurity'] }]
  },
  {
    assessmentId: 'technical-assessment-xra2lrg',
    name: 'Cybersecurity: Intermediate',
    tier: 'medium',
    skills: [{ key: 'cybersecurity', label: 'Cybersecurity', ratingKeys: ['Cybersecurity'] }]
  },
  {
    assessmentId: 'technical-assessment-eppxb4p',
    name: 'Cybersecurity: Advanced',
    tier: 'hard',
    skills: [{ key: 'cybersecurity', label: 'Cybersecurity', ratingKeys: ['Cybersecurity'] }]
  },
  {
    assessmentId: 'technical-assessment-inc3j1t',
    name: 'Cybersecurity: Expert',
    tier: 'expert',
    skills: [{ key: 'cybersecurity', label: 'Cybersecurity', ratingKeys: ['Cybersecurity'] }]
  },
  {
    assessmentId: 'technical-assessment-olzmjvf',
    name: 'Git: Basic',
    tier: 'easy',
    skills: [{ key: 'git', label: 'Git', ratingKeys: ['Git'] }]
  },
  {
    assessmentId: 'technical-assessment-cjm8y7t',
    name: 'Git: Intermediate',
    tier: 'medium',
    skills: [{ key: 'git', label: 'Git', ratingKeys: ['Git'] }]
  },
  {
    assessmentId: 'technical-assessment-uvugn2e',
    name: 'Git: Advanced',
    tier: 'hard',
    skills: [{ key: 'git', label: 'Git', ratingKeys: ['Git'] }]
  },
  {
    assessmentId: 'technical-assessment-7keogsr',
    name: 'Git: Expert',
    tier: 'expert',
    skills: [{ key: 'git', label: 'Git', ratingKeys: ['Git'] }]
  },
  {
    assessmentId: 'technical-assessment-0gy5wgt',
    name: 'QA: Basic',
    tier: 'easy',
    skills: [{ key: 'qa', label: 'QA', ratingKeys: ['QA'] }]
  },
  {
    assessmentId: 'technical-assessment-hfgbjng',
    name: 'QA: Intermediate',
    tier: 'medium',
    skills: [{ key: 'qa', label: 'QA', ratingKeys: ['QA'] }]
  },
  {
    assessmentId: 'technical-assessment-5vkutnf',
    name: 'QA: Advanced',
    tier: 'hard',
    skills: [{ key: 'qa', label: 'QA', ratingKeys: ['QA'] }]
  },
  {
    assessmentId: 'technical-assessment-13mhar9',
    name: 'QA: Expert',
    tier: 'expert',
    skills: [{ key: 'qa', label: 'QA', ratingKeys: ['QA'] }]
  },
  {
    assessmentId: 'technical-assessment-ub0iqre',
    name: 'Azure: Basic',
    tier: 'easy',
    skills: [{ key: 'azure', label: 'Azure', ratingKeys: ['Azure'] }]
  },
  {
    assessmentId: 'technical-assessment-mzzg8bo',
    name: 'Azure: Intermediate',
    tier: 'medium',
    skills: [{ key: 'azure', label: 'Azure', ratingKeys: ['Azure'] }]
  },
  {
    assessmentId: 'technical-assessment-0y3swlq',
    name: 'Azure: Advanced',
    tier: 'hard',
    skills: [{ key: 'azure', label: 'Azure', ratingKeys: ['Azure'] }]
  },
  {
    assessmentId: 'technical-assessment-8qmk8mc',
    name: 'Azure: Expert',
    tier: 'expert',
    skills: [{ key: 'azure', label: 'Azure', ratingKeys: ['Azure'] }]
  },
  {
    assessmentId: 'technical-assessment-y7yhnlp',
    name: 'AWS: Basic',
    tier: 'easy',
    skills: [{ key: 'aws', label: 'AWS', ratingKeys: ['AWS'] }]
  },
  {
    assessmentId: 'technical-assessment-1hvjxop',
    name: 'AWS: Intermediate',
    tier: 'medium',
    skills: [{ key: 'aws', label: 'AWS', ratingKeys: ['AWS'] }]
  },
  {
    assessmentId: 'technical-assessment-khkzhdv',
    name: 'AWS: Advanced',
    tier: 'hard',
    skills: [{ key: 'aws', label: 'AWS', ratingKeys: ['AWS'] }]
  },
  {
    assessmentId: 'technical-assessment-d0n8swf',
    name: 'AWS: Expert',
    tier: 'expert',
    skills: [{ key: 'aws', label: 'AWS', ratingKeys: ['AWS'] }]
  }
];

// Replaced by the rebuilt ladders above (Oct 27): switched off so nobody is invited to a deleted test.
const RETIRED = ['technical-assessment-vfz8sshskk', 'technical-assessment-ri47ell', 'technical-assessment-mf0xyfm',
  'technical-assessment-60u9p66', 'technical-assessment-1h80fbo', 'technical-assessment-q9cw2os'];

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
    console.log(`${apply ? 'DEACTIVATE' : 'would deactivate'} ${RETIRED.length} old Agile/Linux rows`);
    if (apply) await SkillAssessment.updateMany({ assessmentId: { $in: RETIRED } }, { $set: { active: false } });
    if (!apply) console.log('Run with --apply to save.');
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
