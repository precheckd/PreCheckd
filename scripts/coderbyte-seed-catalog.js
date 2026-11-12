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
  },
  {
    assessmentId: 'technical-assessment-9u8uyl9',
    name: 'Docker: Basic',
    tier: 'easy',
    skills: [{ key: 'docker', label: 'Docker', ratingKeys: ['Docker'] }]
  },
  {
    assessmentId: 'technical-assessment-d2ncx94',
    name: 'Docker: Intermediate',
    tier: 'medium',
    skills: [{ key: 'docker', label: 'Docker', ratingKeys: ['Docker'] }]
  },
  {
    assessmentId: 'technical-assessment-dnj63xa',
    name: 'Docker: Advanced',
    tier: 'hard',
    skills: [{ key: 'docker', label: 'Docker', ratingKeys: ['Docker'] }]
  },
  {
    assessmentId: 'technical-assessment-0vlcvd3',
    name: 'Docker: Expert',
    tier: 'expert',
    skills: [{ key: 'docker', label: 'Docker', ratingKeys: ['Docker'] }]
  },
  {
    assessmentId: 'technical-assessment-23d9m10',
    name: 'Excel: Basic',
    tier: 'easy',
    skills: [{ key: 'excel', label: 'Excel', ratingKeys: ['Excel'] }]
  },
  {
    assessmentId: 'technical-assessment-xxydmr4',
    name: 'Excel: Intermediate',
    tier: 'medium',
    skills: [{ key: 'excel', label: 'Excel', ratingKeys: ['Excel'] }]
  },
  {
    assessmentId: 'technical-assessment-hgt955r',
    name: 'Excel: Advanced',
    tier: 'hard',
    skills: [{ key: 'excel', label: 'Excel', ratingKeys: ['Excel'] }]
  },
  {
    assessmentId: 'technical-assessment-fqhyi7u',
    name: 'Excel: Expert',
    tier: 'expert',
    skills: [{ key: 'excel', label: 'Excel', ratingKeys: ['Excel'] }]
  },
  {
    assessmentId: 'technical-assessment-s5tp7ys',
    name: 'GCP: Basic',
    tier: 'easy',
    skills: [{ key: 'gcp', label: 'GCP', ratingKeys: ['GCP'] }]
  },
  {
    assessmentId: 'technical-assessment-x3o55tt',
    name: 'GCP: Intermediate',
    tier: 'medium',
    skills: [{ key: 'gcp', label: 'GCP', ratingKeys: ['GCP'] }]
  },
  {
    assessmentId: 'technical-assessment-v3o11uj',
    name: 'GCP: Advanced',
    tier: 'hard',
    skills: [{ key: 'gcp', label: 'GCP', ratingKeys: ['GCP'] }]
  },
  {
    assessmentId: 'technical-assessment-1lr9a5n',
    name: 'GCP: Expert',
    tier: 'expert',
    skills: [{ key: 'gcp', label: 'GCP', ratingKeys: ['GCP'] }]
  },
  {
    assessmentId: 'technical-assessment-7ugdcb9',
    name: 'Java: Basic',
    tier: 'easy',
    skills: [{ key: 'java', label: 'Java', ratingKeys: ['Java'] }]
  },
  {
    assessmentId: 'technical-assessment-7xj8tbz',
    name: 'Java: Intermediate',
    tier: 'medium',
    skills: [{ key: 'java', label: 'Java', ratingKeys: ['Java'] }]
  },
  {
    assessmentId: 'technical-assessment-xowurx4',
    name: 'Java: Advanced',
    tier: 'hard',
    skills: [{ key: 'java', label: 'Java', ratingKeys: ['Java'] }]
  },
  {
    assessmentId: 'technical-assessment-cte6sz0',
    name: 'Java: Expert',
    tier: 'expert',
    skills: [{ key: 'java', label: 'Java', ratingKeys: ['Java'] }]
  },
  {
    assessmentId: 'technical-assessment-hie13ht',
    name: 'JavaScript: Basic',
    tier: 'easy',
    skills: [{ key: 'javascript', label: 'JavaScript', ratingKeys: ['JavaScript'] }]
  },
  {
    assessmentId: 'technical-assessment-jxier3q',
    name: 'JavaScript: Intermediate',
    tier: 'medium',
    skills: [{ key: 'javascript', label: 'JavaScript', ratingKeys: ['JavaScript'] }]
  },
  {
    assessmentId: 'technical-assessment-p880mip',
    name: 'JavaScript: Advanced',
    tier: 'hard',
    skills: [{ key: 'javascript', label: 'JavaScript', ratingKeys: ['JavaScript'] }]
  },
  {
    assessmentId: 'technical-assessment-fanvykh',
    name: 'JavaScript: Expert',
    tier: 'expert',
    skills: [{ key: 'javascript', label: 'JavaScript', ratingKeys: ['JavaScript'] }]
  },
  {
    assessmentId: 'technical-assessment-6sv6ucl',
    name: 'Kubernetes: Basic',
    tier: 'easy',
    skills: [{ key: 'kubernetes', label: 'Kubernetes', ratingKeys: ['Kubernetes'] }]
  },
  {
    assessmentId: 'technical-assessment-uvaj4do',
    name: 'Kubernetes: Intermediate',
    tier: 'medium',
    skills: [{ key: 'kubernetes', label: 'Kubernetes', ratingKeys: ['Kubernetes'] }]
  },
  {
    assessmentId: 'technical-assessment-u4mnrig',
    name: 'Kubernetes: Advanced',
    tier: 'hard',
    skills: [{ key: 'kubernetes', label: 'Kubernetes', ratingKeys: ['Kubernetes'] }]
  },
  {
    assessmentId: 'technical-assessment-704qixy',
    name: 'Kubernetes: Expert',
    tier: 'expert',
    skills: [{ key: 'kubernetes', label: 'Kubernetes', ratingKeys: ['Kubernetes'] }]
  },
  {
    assessmentId: 'technical-assessment-0pvyj4a',
    name: 'React: Basic',
    tier: 'easy',
    skills: [{ key: 'react', label: 'React', ratingKeys: ['React'] }]
  },
  {
    assessmentId: 'technical-assessment-t356ddo',
    name: 'React: Intermediate',
    tier: 'medium',
    skills: [{ key: 'react', label: 'React', ratingKeys: ['React'] }]
  },
  {
    assessmentId: 'technical-assessment-y9fy4pb',
    name: 'React: Advanced',
    tier: 'hard',
    skills: [{ key: 'react', label: 'React', ratingKeys: ['React'] }]
  },
  {
    assessmentId: 'technical-assessment-5nnuwjp',
    name: 'React: Expert',
    tier: 'expert',
    skills: [{ key: 'react', label: 'React', ratingKeys: ['React'] }]
  },
  {
    assessmentId: 'technical-assessment-keeg51j',
    name: 'REST: Basic',
    tier: 'easy',
    skills: [{ key: 'rest', label: 'REST', ratingKeys: ['REST'] }]
  },
  {
    assessmentId: 'technical-assessment-qajvadp',
    name: 'REST: Intermediate',
    tier: 'medium',
    skills: [{ key: 'rest', label: 'REST', ratingKeys: ['REST'] }]
  },
  {
    assessmentId: 'technical-assessment-7r4eb23',
    name: 'REST: Advanced',
    tier: 'hard',
    skills: [{ key: 'rest', label: 'REST', ratingKeys: ['REST'] }]
  },
  {
    assessmentId: 'technical-assessment-e46c83z',
    name: 'REST: Expert',
    tier: 'expert',
    skills: [{ key: 'rest', label: 'REST', ratingKeys: ['REST'] }]
  },
  {
    assessmentId: 'technical-assessment-jhb6igi',
    name: 'Terraform: Basic',
    tier: 'easy',
    skills: [{ key: 'terraform', label: 'Terraform', ratingKeys: ['Terraform'] }]
  },
  {
    assessmentId: 'technical-assessment-0jn1eop',
    name: 'Terraform: Intermediate',
    tier: 'medium',
    skills: [{ key: 'terraform', label: 'Terraform', ratingKeys: ['Terraform'] }]
  },
  {
    assessmentId: 'technical-assessment-jt77gai',
    name: 'Terraform: Advanced',
    tier: 'hard',
    skills: [{ key: 'terraform', label: 'Terraform', ratingKeys: ['Terraform'] }]
  },
  {
    assessmentId: 'technical-assessment-ycwqfvj',
    name: 'Terraform: Expert',
    tier: 'expert',
    skills: [{ key: 'terraform', label: 'Terraform', ratingKeys: ['Terraform'] }]
  },
  {
    assessmentId: 'technical-assessment-mrkbpnf',
    name: 'TypeScript: Basic',
    tier: 'easy',
    skills: [{ key: 'typescript', label: 'TypeScript', ratingKeys: ['TypeScript'] }]
  },
  {
    assessmentId: 'technical-assessment-0l0q0id',
    name: 'TypeScript: Intermediate',
    tier: 'medium',
    skills: [{ key: 'typescript', label: 'TypeScript', ratingKeys: ['TypeScript'] }]
  },
  {
    assessmentId: 'technical-assessment-32xawx9',
    name: 'TypeScript: Advanced',
    tier: 'hard',
    skills: [{ key: 'typescript', label: 'TypeScript', ratingKeys: ['TypeScript'] }]
  },
  {
    assessmentId: 'technical-assessment-a5kd17i',
    name: 'TypeScript: Expert',
    tier: 'expert',
    skills: [{ key: 'typescript', label: 'TypeScript', ratingKeys: ['TypeScript'] }]
  },
  {
    assessmentId: 'technical-assessment-ufiad7o',
    name: 'Power BI: Basic',
    tier: 'easy',
    skills: [{ key: 'power-bi', label: 'Power BI', ratingKeys: ['Power BI'] }]
  },
  {
    assessmentId: 'technical-assessment-93arlmf',
    name: 'Power BI: Intermediate',
    tier: 'medium',
    skills: [{ key: 'power-bi', label: 'Power BI', ratingKeys: ['Power BI'] }]
  },
  {
    assessmentId: 'technical-assessment-p1hh0s7',
    name: 'Power BI: Advanced',
    tier: 'hard',
    skills: [{ key: 'power-bi', label: 'Power BI', ratingKeys: ['Power BI'] }]
  },
  {
    assessmentId: 'technical-assessment-mjdlqhw',
    name: 'Power BI: Expert',
    tier: 'expert',
    skills: [{ key: 'power-bi', label: 'Power BI', ratingKeys: ['Power BI'] }]
  },
  {
    assessmentId: 'technical-assessment-8yg3lfb',
    name: 'PostgreSQL: Basic',
    tier: 'easy',
    skills: [{ key: 'postgresql', label: 'PostgreSQL', ratingKeys: ['PostgreSQL'] }]
  },
  {
    assessmentId: 'technical-assessment-h8c5fna',
    name: 'PostgreSQL: Intermediate',
    tier: 'medium',
    skills: [{ key: 'postgresql', label: 'PostgreSQL', ratingKeys: ['PostgreSQL'] }]
  },
  {
    assessmentId: 'technical-assessment-wsf3g34',
    name: 'PostgreSQL: Advanced',
    tier: 'hard',
    skills: [{ key: 'postgresql', label: 'PostgreSQL', ratingKeys: ['PostgreSQL'] }]
  },
  {
    assessmentId: 'technical-assessment-1vlgy7n',
    name: 'PostgreSQL: Expert',
    tier: 'expert',
    skills: [{ key: 'postgresql', label: 'PostgreSQL', ratingKeys: ['PostgreSQL'] }]
  },
  {
    assessmentId: 'technical-assessment-tcx1z94',
    name: 'Jenkins: Basic',
    tier: 'easy',
    skills: [{ key: 'jenkins', label: 'Jenkins', ratingKeys: ['Jenkins'] }]
  },
  {
    assessmentId: 'technical-assessment-q9uqtif',
    name: 'Jenkins: Intermediate',
    tier: 'medium',
    skills: [{ key: 'jenkins', label: 'Jenkins', ratingKeys: ['Jenkins'] }]
  },
  {
    assessmentId: 'technical-assessment-q8ji0xt',
    name: 'Jenkins: Advanced',
    tier: 'hard',
    skills: [{ key: 'jenkins', label: 'Jenkins', ratingKeys: ['Jenkins'] }]
  },
  {
    assessmentId: 'technical-assessment-wmpv5fy',
    name: 'Jenkins: Expert',
    tier: 'expert',
    skills: [{ key: 'jenkins', label: 'Jenkins', ratingKeys: ['Jenkins'] }]
  },
  {
    assessmentId: 'technical-assessment-cbna2vs',
    name: 'Analyst: Basic',
    tier: 'easy',
    skills: [{ key: 'analyst', label: 'Analyst', ratingKeys: ['Analyst'] }]
  },
  {
    assessmentId: 'technical-assessment-ayt8i4t',
    name: 'Analyst: Intermediate',
    tier: 'medium',
    skills: [{ key: 'analyst', label: 'Analyst', ratingKeys: ['Analyst'] }]
  },
  {
    assessmentId: 'technical-assessment-4l4rhsx',
    name: 'Analyst: Advanced',
    tier: 'hard',
    skills: [{ key: 'analyst', label: 'Analyst', ratingKeys: ['Analyst'] }]
  },
  {
    assessmentId: 'technical-assessment-ops4e7m',
    name: 'Analyst: Expert',
    tier: 'expert',
    skills: [{ key: 'analyst', label: 'Analyst', ratingKeys: ['Analyst'] }]
  },
  {
    assessmentId: 'technical-assessment-986j6fq',
    name: 'CSS: Basic',
    tier: 'easy',
    skills: [{ key: 'css', label: 'CSS', ratingKeys: ['CSS'] }]
  },
  {
    assessmentId: 'technical-assessment-y4yvdjy',
    name: 'CSS: Intermediate',
    tier: 'medium',
    skills: [{ key: 'css', label: 'CSS', ratingKeys: ['CSS'] }]
  },
  {
    assessmentId: 'technical-assessment-sbsyv4i',
    name: 'CSS: Advanced',
    tier: 'hard',
    skills: [{ key: 'css', label: 'CSS', ratingKeys: ['CSS'] }]
  },
  {
    assessmentId: 'technical-assessment-kwap8d9',
    name: 'CSS: Expert',
    tier: 'expert',
    skills: [{ key: 'css', label: 'CSS', ratingKeys: ['CSS'] }]
  },
  {
    assessmentId: 'technical-assessment-mjoft44',
    name: 'MySQL: Basic',
    tier: 'easy',
    skills: [{ key: 'mysql', label: 'MySQL', ratingKeys: ['MySQL'] }]
  },
  {
    assessmentId: 'technical-assessment-op7os4c',
    name: 'MySQL: Intermediate',
    tier: 'medium',
    skills: [{ key: 'mysql', label: 'MySQL', ratingKeys: ['MySQL'] }]
  },
  {
    assessmentId: 'technical-assessment-0amx3sv',
    name: 'MySQL: Advanced',
    tier: 'hard',
    skills: [{ key: 'mysql', label: 'MySQL', ratingKeys: ['MySQL'] }]
  },
  {
    assessmentId: 'technical-assessment-w8d4k8b',
    name: 'MySQL: Expert',
    tier: 'expert',
    skills: [{ key: 'mysql', label: 'MySQL', ratingKeys: ['MySQL'] }]
  },
  {
    assessmentId: 'technical-assessment-5qsm8jq',
    name: 'Selenium: Basic',
    tier: 'easy',
    skills: [{ key: 'selenium', label: 'Selenium', ratingKeys: ['Selenium'] }]
  },
  {
    assessmentId: 'technical-assessment-uees5bp',
    name: 'Selenium: Intermediate',
    tier: 'medium',
    skills: [{ key: 'selenium', label: 'Selenium', ratingKeys: ['Selenium'] }]
  },
  {
    assessmentId: 'technical-assessment-cmcu3yl',
    name: 'Selenium: Advanced',
    tier: 'hard',
    skills: [{ key: 'selenium', label: 'Selenium', ratingKeys: ['Selenium'] }]
  },
  {
    assessmentId: 'technical-assessment-vuufv2l',
    name: 'Selenium: Expert',
    tier: 'expert',
    skills: [{ key: 'selenium', label: 'Selenium', ratingKeys: ['Selenium'] }]
  },
  {
    assessmentId: 'technical-assessment-k22qh8v',
    name: 'Ansible: Basic',
    tier: 'easy',
    skills: [{ key: 'ansible', label: 'Ansible', ratingKeys: ['Ansible'] }]
  },
  {
    assessmentId: 'technical-assessment-oxarfl8',
    name: 'Ansible: Intermediate',
    tier: 'medium',
    skills: [{ key: 'ansible', label: 'Ansible', ratingKeys: ['Ansible'] }]
  },
  {
    assessmentId: 'technical-assessment-zy25ywa',
    name: 'Ansible: Advanced',
    tier: 'hard',
    skills: [{ key: 'ansible', label: 'Ansible', ratingKeys: ['Ansible'] }]
  },
  {
    assessmentId: 'technical-assessment-rwdcj6j',
    name: 'Ansible: Expert',
    tier: 'expert',
    skills: [{ key: 'ansible', label: 'Ansible', ratingKeys: ['Ansible'] }]
  },
  {
    assessmentId: 'technical-assessment-4nw5g6n',
    name: 'MITRE: Basic',
    tier: 'easy',
    skills: [{ key: 'mitre', label: 'MITRE', ratingKeys: ['MITRE'] }]
  },
  {
    assessmentId: 'technical-assessment-veexqya',
    name: 'MITRE: Intermediate',
    tier: 'medium',
    skills: [{ key: 'mitre', label: 'MITRE', ratingKeys: ['MITRE'] }]
  },
  {
    assessmentId: 'technical-assessment-z2ivj78',
    name: 'MITRE: Advanced',
    tier: 'hard',
    skills: [{ key: 'mitre', label: 'MITRE', ratingKeys: ['MITRE'] }]
  },
  {
    assessmentId: 'technical-assessment-zad4vn2',
    name: 'MITRE: Expert',
    tier: 'expert',
    skills: [{ key: 'mitre', label: 'MITRE', ratingKeys: ['MITRE'] }]
  },
  {
    assessmentId: 'technical-assessment-68vz1hx',
    name: 'HTML: Basic',
    tier: 'easy',
    skills: [{ key: 'html', label: 'HTML', ratingKeys: ['HTML'] }]
  },
  {
    assessmentId: 'technical-assessment-1s5aggf',
    name: 'HTML: Intermediate',
    tier: 'medium',
    skills: [{ key: 'html', label: 'HTML', ratingKeys: ['HTML'] }]
  },
  {
    assessmentId: 'technical-assessment-hnp6dzu',
    name: 'HTML: Advanced',
    tier: 'hard',
    skills: [{ key: 'html', label: 'HTML', ratingKeys: ['HTML'] }]
  },
  {
    assessmentId: 'technical-assessment-sp9376u',
    name: 'HTML: Expert',
    tier: 'expert',
    skills: [{ key: 'html', label: 'HTML', ratingKeys: ['HTML'] }]
  },
  {
    assessmentId: 'technical-assessment-hhmllbv',
    name: 'C++: Basic',
    tier: 'easy',
    skills: [{ key: 'cpp', label: 'C++', ratingKeys: ['C++'] }]
  },
  {
    assessmentId: 'technical-assessment-3g3n2jh',
    name: 'C++: Intermediate',
    tier: 'medium',
    skills: [{ key: 'cpp', label: 'C++', ratingKeys: ['C++'] }]
  },
  {
    assessmentId: 'technical-assessment-45mjd3g',
    name: 'C++: Advanced',
    tier: 'hard',
    skills: [{ key: 'cpp', label: 'C++', ratingKeys: ['C++'] }]
  },
  {
    assessmentId: 'technical-assessment-i6m4ocv',
    name: 'C++: Expert',
    tier: 'expert',
    skills: [{ key: 'cpp', label: 'C++', ratingKeys: ['C++'] }]
  },
  {
    assessmentId: 'technical-assessment-drusvkj',
    name: 'Kotlin: Basic',
    tier: 'easy',
    skills: [{ key: 'kotlin', label: 'Kotlin', ratingKeys: ['Kotlin'] }]
  },
  {
    assessmentId: 'technical-assessment-y6djjic',
    name: 'Kotlin: Intermediate',
    tier: 'medium',
    skills: [{ key: 'kotlin', label: 'Kotlin', ratingKeys: ['Kotlin'] }]
  },
  {
    assessmentId: 'technical-assessment-x8d9wdz',
    name: 'Kotlin: Advanced',
    tier: 'hard',
    skills: [{ key: 'kotlin', label: 'Kotlin', ratingKeys: ['Kotlin'] }]
  },
  {
    assessmentId: 'technical-assessment-0913dzr',
    name: 'Kotlin: Expert',
    tier: 'expert',
    skills: [{ key: 'kotlin', label: 'Kotlin', ratingKeys: ['Kotlin'] }]
  },
  {
    assessmentId: 'technical-assessment-6y68baf',
    name: 'Swift: Basic',
    tier: 'easy',
    skills: [{ key: 'swift', label: 'Swift', ratingKeys: ['Swift'] }]
  },
  {
    assessmentId: 'technical-assessment-jy65c4k',
    name: 'Swift: Intermediate',
    tier: 'medium',
    skills: [{ key: 'swift', label: 'Swift', ratingKeys: ['Swift'] }]
  },
  {
    assessmentId: 'technical-assessment-zmj8juz',
    name: 'Swift: Advanced',
    tier: 'hard',
    skills: [{ key: 'swift', label: 'Swift', ratingKeys: ['Swift'] }]
  },
  {
    assessmentId: 'technical-assessment-7i49xe1',
    name: 'Swift: Expert',
    tier: 'expert',
    skills: [{ key: 'swift', label: 'Swift', ratingKeys: ['Swift'] }]
  },
  {
    assessmentId: 'technical-assessment-zdft1wu',
    name: 'Next.js: Basic',
    tier: 'easy',
    skills: [{ key: 'nextjs', label: 'Next.js', ratingKeys: ['Next.js'] }]
  },
  {
    assessmentId: 'technical-assessment-aylkhdd',
    name: 'Next.js: Intermediate',
    tier: 'medium',
    skills: [{ key: 'nextjs', label: 'Next.js', ratingKeys: ['Next.js'] }]
  },
  {
    assessmentId: 'technical-assessment-stmtj1w',
    name: 'Next.js: Advanced',
    tier: 'hard',
    skills: [{ key: 'nextjs', label: 'Next.js', ratingKeys: ['Next.js'] }]
  },
  {
    assessmentId: 'technical-assessment-yxebpxy',
    name: 'Next.js: Expert',
    tier: 'expert',
    skills: [{ key: 'nextjs', label: 'Next.js', ratingKeys: ['Next.js'] }]
  },
  {
    assessmentId: 'technical-assessment-r5zs2cb',
    name: 'Spring: Basic',
    tier: 'easy',
    skills: [{ key: 'spring', label: 'Spring', ratingKeys: ['Spring'] }]
  },
  {
    assessmentId: 'technical-assessment-ujd2u2c',
    name: 'Spring: Intermediate',
    tier: 'medium',
    skills: [{ key: 'spring', label: 'Spring', ratingKeys: ['Spring'] }]
  },
  {
    assessmentId: 'technical-assessment-pnrf8pd',
    name: 'Spring: Advanced',
    tier: 'hard',
    skills: [{ key: 'spring', label: 'Spring', ratingKeys: ['Spring'] }]
  },
  {
    assessmentId: 'technical-assessment-1zz561w',
    name: 'Spring: Expert',
    tier: 'expert',
    skills: [{ key: 'spring', label: 'Spring', ratingKeys: ['Spring'] }]
  },
  {
    assessmentId: 'technical-assessment-6mnfoec',
    name: 'PySpark: Basic',
    tier: 'easy',
    skills: [{ key: 'pyspark', label: 'PySpark', ratingKeys: ['PySpark'] }]
  },
  {
    assessmentId: 'technical-assessment-xt3zb2n',
    name: 'PySpark: Intermediate',
    tier: 'medium',
    skills: [{ key: 'pyspark', label: 'PySpark', ratingKeys: ['PySpark'] }]
  },
  {
    assessmentId: 'technical-assessment-0ohp3ue',
    name: 'PySpark: Advanced',
    tier: 'hard',
    skills: [{ key: 'pyspark', label: 'PySpark', ratingKeys: ['PySpark'] }]
  },
  {
    assessmentId: 'technical-assessment-fypvehd',
    name: 'PySpark: Expert',
    tier: 'expert',
    skills: [{ key: 'pyspark', label: 'PySpark', ratingKeys: ['PySpark'] }]
  },
  {
    assessmentId: 'technical-assessment-bevo3ip',
    name: 'Pentest: Basic',
    tier: 'easy',
    skills: [{ key: 'pentest', label: 'Pentest', ratingKeys: ['Pentest'] }]
  },
  {
    assessmentId: 'technical-assessment-lfungtw',
    name: 'Pentest: Intermediate',
    tier: 'medium',
    skills: [{ key: 'pentest', label: 'Pentest', ratingKeys: ['Pentest'] }]
  },
  {
    assessmentId: 'technical-assessment-sorj1vd',
    name: 'Pentest: Advanced',
    tier: 'hard',
    skills: [{ key: 'pentest', label: 'Pentest', ratingKeys: ['Pentest'] }]
  },
  {
    assessmentId: 'technical-assessment-0qum63m',
    name: 'Pentest: Expert',
    tier: 'expert',
    skills: [{ key: 'pentest', label: 'Pentest', ratingKeys: ['Pentest'] }]
  },
  {
    assessmentId: 'technical-assessment-uiw6ts3',
    name: 'Pandas: Basic',
    tier: 'easy',
    skills: [{ key: 'pandas', label: 'Pandas', ratingKeys: ['Pandas'] }]
  },
  {
    assessmentId: 'technical-assessment-kgz9tsi',
    name: 'Pandas: Intermediate',
    tier: 'medium',
    skills: [{ key: 'pandas', label: 'Pandas', ratingKeys: ['Pandas'] }]
  },
  {
    assessmentId: 'technical-assessment-7hzcjfi',
    name: 'Pandas: Advanced',
    tier: 'hard',
    skills: [{ key: 'pandas', label: 'Pandas', ratingKeys: ['Pandas'] }]
  },
  {
    assessmentId: 'technical-assessment-p459n1b',
    name: 'Pandas: Expert',
    tier: 'expert',
    skills: [{ key: 'pandas', label: 'Pandas', ratingKeys: ['Pandas'] }]
  },
  {
    assessmentId: 'technical-assessment-f1z445c',
    name: 'ETL: Basic',
    tier: 'easy',
    skills: [{ key: 'etl', label: 'ETL', ratingKeys: ['ETL'] }]
  },
  {
    assessmentId: 'technical-assessment-480q7u9',
    name: 'ETL: Intermediate',
    tier: 'medium',
    skills: [{ key: 'etl', label: 'ETL', ratingKeys: ['ETL'] }]
  },
  {
    assessmentId: 'technical-assessment-2klj2qy',
    name: 'ETL: Advanced',
    tier: 'hard',
    skills: [{ key: 'etl', label: 'ETL', ratingKeys: ['ETL'] }]
  },
  {
    assessmentId: 'technical-assessment-lawxp9x',
    name: 'ETL: Expert',
    tier: 'expert',
    skills: [{ key: 'etl', label: 'ETL', ratingKeys: ['ETL'] }]
  },
  {
    assessmentId: 'technical-assessment-g53yi6d',
    name: 'Tableau: Basic',
    tier: 'easy',
    skills: [{ key: 'tableau', label: 'Tableau', ratingKeys: ['Tableau'] }]
  },
  {
    assessmentId: 'technical-assessment-qi560vu',
    name: 'Tableau: Intermediate',
    tier: 'medium',
    skills: [{ key: 'tableau', label: 'Tableau', ratingKeys: ['Tableau'] }]
  },
  {
    assessmentId: 'technical-assessment-thylah4',
    name: 'Tableau: Advanced',
    tier: 'hard',
    skills: [{ key: 'tableau', label: 'Tableau', ratingKeys: ['Tableau'] }]
  },
  {
    assessmentId: 'technical-assessment-zd68j8a',
    name: 'Tableau: Expert',
    tier: 'expert',
    skills: [{ key: 'tableau', label: 'Tableau', ratingKeys: ['Tableau'] }]
  },
  {
    assessmentId: 'technical-assessment-lfldysr',
    name: 'NumPy: Basic',
    tier: 'easy',
    skills: [{ key: 'numpy', label: 'NumPy', ratingKeys: ['NumPy'] }]
  },
  {
    assessmentId: 'technical-assessment-wh6krr6',
    name: 'NumPy: Intermediate',
    tier: 'medium',
    skills: [{ key: 'numpy', label: 'NumPy', ratingKeys: ['NumPy'] }]
  },
  {
    assessmentId: 'technical-assessment-7gun823',
    name: 'NumPy: Advanced',
    tier: 'hard',
    skills: [{ key: 'numpy', label: 'NumPy', ratingKeys: ['NumPy'] }]
  },
  {
    assessmentId: 'technical-assessment-ywzh7u7',
    name: 'NumPy: Expert',
    tier: 'expert',
    skills: [{ key: 'numpy', label: 'NumPy', ratingKeys: ['NumPy'] }]
  },
  {
    assessmentId: 'technical-assessment-5931zp0',
    name: 'PHP: Basic',
    tier: 'easy',
    skills: [{ key: 'php', label: 'PHP', ratingKeys: ['PHP'] }]
  },
  {
    assessmentId: 'technical-assessment-poxm897',
    name: 'PHP: Intermediate',
    tier: 'medium',
    skills: [{ key: 'php', label: 'PHP', ratingKeys: ['PHP'] }]
  },
  {
    assessmentId: 'technical-assessment-i6ibw4y',
    name: 'PHP: Advanced',
    tier: 'hard',
    skills: [{ key: 'php', label: 'PHP', ratingKeys: ['PHP'] }]
  },
  {
    assessmentId: 'technical-assessment-y9sv97p',
    name: 'PHP: Expert',
    tier: 'expert',
    skills: [{ key: 'php', label: 'PHP', ratingKeys: ['PHP'] }]
  },
  {
    assessmentId: 'technical-assessment-4ledd7a',
    name: 'MongoDB: Basic',
    tier: 'easy',
    skills: [{ key: 'mongodb', label: 'MongoDB', ratingKeys: ['MongoDB'] }]
  },
  {
    assessmentId: 'technical-assessment-xvaidn1',
    name: 'MongoDB: Intermediate',
    tier: 'medium',
    skills: [{ key: 'mongodb', label: 'MongoDB', ratingKeys: ['MongoDB'] }]
  },
  {
    assessmentId: 'technical-assessment-j4zu6wg',
    name: 'MongoDB: Advanced',
    tier: 'hard',
    skills: [{ key: 'mongodb', label: 'MongoDB', ratingKeys: ['MongoDB'] }]
  },
  {
    assessmentId: 'technical-assessment-q2ncgs8',
    name: 'MongoDB: Expert',
    tier: 'expert',
    skills: [{ key: 'mongodb', label: 'MongoDB', ratingKeys: ['MongoDB'] }]
  },
  {
    assessmentId: 'technical-assessment-gb4xhlq',
    name: 'System Design: Basic',
    tier: 'easy',
    skills: [{ key: 'system-design', label: 'System Design', ratingKeys: ['System Design'] }]
  },
  {
    assessmentId: 'technical-assessment-jbv2na7',
    name: 'System Design: Intermediate',
    tier: 'medium',
    skills: [{ key: 'system-design', label: 'System Design', ratingKeys: ['System Design'] }]
  },
  {
    assessmentId: 'technical-assessment-606m6it',
    name: 'System Design: Advanced',
    tier: 'hard',
    skills: [{ key: 'system-design', label: 'System Design', ratingKeys: ['System Design'] }]
  },
  {
    assessmentId: 'technical-assessment-x6j8hcw',
    name: 'System Design: Expert',
    tier: 'expert',
    skills: [{ key: 'system-design', label: 'System Design', ratingKeys: ['System Design'] }]
  },
  {
    assessmentId: 'technical-assessment-oaiv07t',
    name: '.NET: Basic',
    tier: 'easy',
    skills: [{ key: 'dotnet', label: '.NET', ratingKeys: ['.NET', 'Dotnet'] }]
  },
  {
    assessmentId: 'technical-assessment-q8grcuj',
    name: '.NET: Intermediate',
    tier: 'medium',
    skills: [{ key: 'dotnet', label: '.NET', ratingKeys: ['.NET', 'Dotnet'] }]
  },
  {
    assessmentId: 'technical-assessment-lx6bf34',
    name: '.NET: Advanced',
    tier: 'hard',
    skills: [{ key: 'dotnet', label: '.NET', ratingKeys: ['.NET', 'Dotnet'] }]
  },
  {
    assessmentId: 'technical-assessment-ronq64x',
    name: '.NET: Expert',
    tier: 'expert',
    skills: [{ key: 'dotnet', label: '.NET', ratingKeys: ['.NET', 'Dotnet'] }]
  },
  {
    assessmentId: 'technical-assessment-f9n9jw6',
    name: 'Node.js: Basic',
    tier: 'easy',
    skills: [{ key: 'nodejs', label: 'Node.js', ratingKeys: ['Node.js'] }]
  },
  {
    assessmentId: 'technical-assessment-6os7nln',
    name: 'Node.js: Intermediate',
    tier: 'medium',
    skills: [{ key: 'nodejs', label: 'Node.js', ratingKeys: ['Node.js'] }]
  },
  {
    assessmentId: 'technical-assessment-kr8irve',
    name: 'Node.js: Advanced',
    tier: 'hard',
    skills: [{ key: 'nodejs', label: 'Node.js', ratingKeys: ['Node.js'] }]
  },
  {
    assessmentId: 'technical-assessment-d8g348q',
    name: 'Node.js: Expert',
    tier: 'expert',
    skills: [{ key: 'nodejs', label: 'Node.js', ratingKeys: ['Node.js'] }]
  },
  {
    assessmentId: 'technical-assessment-1pjbid1',
    name: 'C#: Basic',
    tier: 'easy',
    skills: [{ key: 'c-sharp', label: 'C#', ratingKeys: ['C#', 'Csharp'] }]
  },
  {
    assessmentId: 'technical-assessment-rmufbg2',
    name: 'C#: Intermediate',
    tier: 'medium',
    skills: [{ key: 'c-sharp', label: 'C#', ratingKeys: ['C#', 'Csharp'] }]
  },
  {
    assessmentId: 'technical-assessment-ly2qgua',
    name: 'C#: Advanced',
    tier: 'hard',
    skills: [{ key: 'c-sharp', label: 'C#', ratingKeys: ['C#', 'Csharp'] }]
  },
  {
    assessmentId: 'technical-assessment-xlhpsek',
    name: 'C#: Expert',
    tier: 'expert',
    skills: [{ key: 'c-sharp', label: 'C#', ratingKeys: ['C#', 'Csharp'] }]
  },
  {
    assessmentId: 'technical-assessment-ynu4o4e',
    name: 'Android: Basic',
    tier: 'easy',
    skills: [{ key: 'android', label: 'Android', ratingKeys: ['Android'] }]
  },
  {
    assessmentId: 'technical-assessment-f5em921',
    name: 'Android: Intermediate',
    tier: 'medium',
    skills: [{ key: 'android', label: 'Android', ratingKeys: ['Android'] }]
  },
  {
    assessmentId: 'technical-assessment-g0lrr73',
    name: 'Android: Advanced',
    tier: 'hard',
    skills: [{ key: 'android', label: 'Android', ratingKeys: ['Android'] }]
  },
  {
    assessmentId: 'technical-assessment-vlopl6a',
    name: 'Android: Expert',
    tier: 'expert',
    skills: [{ key: 'android', label: 'Android', ratingKeys: ['Android'] }]
  },
  {
    assessmentId: 'technical-assessment-8jzwx7r',
    name: 'Bash: Basic',
    tier: 'easy',
    skills: [{ key: 'bash', label: 'Bash', ratingKeys: ['Bash'] }]
  },
  {
    assessmentId: 'technical-assessment-88su8av',
    name: 'Bash: Intermediate',
    tier: 'medium',
    skills: [{ key: 'bash', label: 'Bash', ratingKeys: ['Bash'] }]
  },
  {
    assessmentId: 'technical-assessment-nw01de2',
    name: 'Bash: Advanced',
    tier: 'hard',
    skills: [{ key: 'bash', label: 'Bash', ratingKeys: ['Bash'] }]
  },
  {
    assessmentId: 'technical-assessment-xbxjyll',
    name: 'Bash: Expert',
    tier: 'expert',
    skills: [{ key: 'bash', label: 'Bash', ratingKeys: ['Bash'] }]
  },
  {
    assessmentId: 'technical-assessment-hnfp7xu',
    name: 'Algorithms: Basic',
    tier: 'easy',
    skills: [{ key: 'algorithms', label: 'Algorithms', ratingKeys: ['Algorithms'] }]
  },
  {
    assessmentId: 'technical-assessment-ktmwxgy',
    name: 'Algorithms: Intermediate',
    tier: 'medium',
    skills: [{ key: 'algorithms', label: 'Algorithms', ratingKeys: ['Algorithms'] }]
  },
  {
    assessmentId: 'technical-assessment-omm73eh',
    name: 'Algorithms: Advanced',
    tier: 'hard',
    skills: [{ key: 'algorithms', label: 'Algorithms', ratingKeys: ['Algorithms'] }]
  },
  {
    assessmentId: 'technical-assessment-2uf4ba6',
    name: 'Algorithms: Expert',
    tier: 'expert',
    skills: [{ key: 'algorithms', label: 'Algorithms', ratingKeys: ['Algorithms'] }]
  },
  {
    assessmentId: 'technical-assessment-gx0op71',
    name: 'Go: Basic',
    tier: 'easy',
    skills: [{ key: 'go', label: 'Go', ratingKeys: ['Go'] }]
  },
  {
    assessmentId: 'technical-assessment-4cttpyx',
    name: 'Go: Intermediate',
    tier: 'medium',
    skills: [{ key: 'go', label: 'Go', ratingKeys: ['Go'] }]
  },
  {
    assessmentId: 'technical-assessment-tpt0ngd',
    name: 'Go: Advanced',
    tier: 'hard',
    skills: [{ key: 'go', label: 'Go', ratingKeys: ['Go'] }]
  },
  {
    assessmentId: 'technical-assessment-4kgsyjo',
    name: 'Go: Expert',
    tier: 'expert',
    skills: [{ key: 'go', label: 'Go', ratingKeys: ['Go'] }]
  },
  {
    assessmentId: 'technical-assessment-p5rwkob',
    name: 'Figma: Basic',
    tier: 'easy',
    skills: [{ key: 'figma', label: 'Figma', ratingKeys: ['Figma'] }]
  },
  {
    assessmentId: 'technical-assessment-cal2ow4',
    name: 'Figma: Intermediate',
    tier: 'medium',
    skills: [{ key: 'figma', label: 'Figma', ratingKeys: ['Figma'] }]
  },
  {
    assessmentId: 'technical-assessment-ilwhtds',
    name: 'Figma: Advanced',
    tier: 'hard',
    skills: [{ key: 'figma', label: 'Figma', ratingKeys: ['Figma'] }]
  },
  {
    assessmentId: 'technical-assessment-bqpxip4',
    name: 'Figma: Expert',
    tier: 'expert',
    skills: [{ key: 'figma', label: 'Figma', ratingKeys: ['Figma'] }]
  },
  {
    assessmentId: 'technical-assessment-dmrszf6',
    name: 'Vue.js: Basic',
    tier: 'easy',
    skills: [{ key: 'vue-js', label: 'Vue.js', ratingKeys: ['Vue.js'] }]
  },
  {
    assessmentId: 'technical-assessment-x5f03of',
    name: 'Vue.js: Intermediate',
    tier: 'medium',
    skills: [{ key: 'vue-js', label: 'Vue.js', ratingKeys: ['Vue.js'] }]
  },
  {
    assessmentId: 'technical-assessment-s7f0my6',
    name: 'Vue.js: Advanced',
    tier: 'hard',
    skills: [{ key: 'vue-js', label: 'Vue.js', ratingKeys: ['Vue.js'] }]
  },
  {
    assessmentId: 'technical-assessment-7oh1ggp',
    name: 'Vue.js: Expert',
    tier: 'expert',
    skills: [{ key: 'vue-js', label: 'Vue.js', ratingKeys: ['Vue.js'] }]
  },
  {
    assessmentId: 'technical-assessment-lmn8ldi',
    name: 'iOS: Basic',
    tier: 'easy',
    skills: [{ key: 'ios', label: 'iOS', ratingKeys: ['iOS'] }]
  },
  {
    assessmentId: 'technical-assessment-qi17pp0',
    name: 'iOS: Intermediate',
    tier: 'medium',
    skills: [{ key: 'ios', label: 'iOS', ratingKeys: ['iOS'] }]
  },
  {
    assessmentId: 'technical-assessment-dema9pz',
    name: 'iOS: Advanced',
    tier: 'hard',
    skills: [{ key: 'ios', label: 'iOS', ratingKeys: ['iOS'] }]
  },
  {
    assessmentId: 'technical-assessment-j39cybv',
    name: 'iOS: Expert',
    tier: 'expert',
    skills: [{ key: 'ios', label: 'iOS', ratingKeys: ['iOS'] }]
  },
  {
    assessmentId: 'technical-assessment-p2qfqls',
    name: 'Playwright: Basic',
    tier: 'easy',
    skills: [{ key: 'playwright', label: 'Playwright', ratingKeys: ['Playwright'] }]
  },
  {
    assessmentId: 'technical-assessment-3o64qq5',
    name: 'Playwright: Intermediate',
    tier: 'medium',
    skills: [{ key: 'playwright', label: 'Playwright', ratingKeys: ['Playwright'] }]
  },
  {
    assessmentId: 'technical-assessment-8ml1ylh',
    name: 'Playwright: Advanced',
    tier: 'hard',
    skills: [{ key: 'playwright', label: 'Playwright', ratingKeys: ['Playwright'] }]
  },
  {
    assessmentId: 'technical-assessment-d5lq6nk',
    name: 'Playwright: Expert',
    tier: 'expert',
    skills: [{ key: 'playwright', label: 'Playwright', ratingKeys: ['Playwright'] }]
  },
  {
    assessmentId: 'technical-assessment-bqnuhh6',
    name: 'Angular: Basic',
    tier: 'easy',
    skills: [{ key: 'angular', label: 'Angular', ratingKeys: ['Angular'] }]
  },
  {
    assessmentId: 'technical-assessment-k0k08dw',
    name: 'Angular: Intermediate',
    tier: 'medium',
    skills: [{ key: 'angular', label: 'Angular', ratingKeys: ['Angular'] }]
  },
  {
    assessmentId: 'technical-assessment-f6o2nuu',
    name: 'Angular: Advanced',
    tier: 'hard',
    skills: [{ key: 'angular', label: 'Angular', ratingKeys: ['Angular'] }]
  },
  {
    assessmentId: 'technical-assessment-qwdtdzb',
    name: 'Angular: Expert',
    tier: 'expert',
    skills: [{ key: 'angular', label: 'Angular', ratingKeys: ['Angular'] }]
  },
  {
    assessmentId: 'technical-assessment-4gyvsiq',
    name: 'Appium: Basic',
    tier: 'easy',
    skills: [{ key: 'appium', label: 'Appium', ratingKeys: ['Appium'] }]
  },
  {
    assessmentId: 'technical-assessment-amrue9o',
    name: 'Appium: Intermediate',
    tier: 'medium',
    skills: [{ key: 'appium', label: 'Appium', ratingKeys: ['Appium'] }]
  },
  {
    assessmentId: 'technical-assessment-q0e6vng',
    name: 'Appium: Advanced',
    tier: 'hard',
    skills: [{ key: 'appium', label: 'Appium', ratingKeys: ['Appium'] }]
  },
  {
    assessmentId: 'technical-assessment-5i15m7n',
    name: 'Appium: Expert',
    tier: 'expert',
    skills: [{ key: 'appium', label: 'Appium', ratingKeys: ['Appium'] }]
  },
  {
    assessmentId: 'technical-assessment-385rppq',
    name: 'Cypress: Basic',
    tier: 'easy',
    skills: [{ key: 'cypress', label: 'Cypress', ratingKeys: ['Cypress'] }]
  },
  {
    assessmentId: 'technical-assessment-1ki74l7',
    name: 'Cypress: Intermediate',
    tier: 'medium',
    skills: [{ key: 'cypress', label: 'Cypress', ratingKeys: ['Cypress'] }]
  },
  {
    assessmentId: 'technical-assessment-n70xwqd',
    name: 'Cypress: Advanced',
    tier: 'hard',
    skills: [{ key: 'cypress', label: 'Cypress', ratingKeys: ['Cypress'] }]
  },
  {
    assessmentId: 'technical-assessment-tz94cml',
    name: 'Cypress: Expert',
    tier: 'expert',
    skills: [{ key: 'cypress', label: 'Cypress', ratingKeys: ['Cypress'] }]
  },
  {
    assessmentId: 'technical-assessment-s5pnlvj',
    name: 'WordPress: Basic',
    tier: 'easy',
    skills: [{ key: 'wordpress', label: 'WordPress', ratingKeys: ['WordPress'] }]
  },
  {
    assessmentId: 'technical-assessment-qoc4qjc',
    name: 'WordPress: Intermediate',
    tier: 'medium',
    skills: [{ key: 'wordpress', label: 'WordPress', ratingKeys: ['WordPress'] }]
  },
  {
    assessmentId: 'technical-assessment-th51hzj',
    name: 'WordPress: Advanced',
    tier: 'hard',
    skills: [{ key: 'wordpress', label: 'WordPress', ratingKeys: ['WordPress'] }]
  },
  {
    assessmentId: 'technical-assessment-xl9eoeg',
    name: 'WordPress: Expert',
    tier: 'expert',
    skills: [{ key: 'wordpress', label: 'WordPress', ratingKeys: ['WordPress'] }]
  },
  {
    assessmentId: 'technical-assessment-p2i01ny',
    name: 'Spreadsheet: Basic',
    tier: 'easy',
    skills: [{ key: 'spreadsheet', label: 'Spreadsheet', ratingKeys: ['Spreadsheet'] }]
  },
  {
    assessmentId: 'technical-assessment-7pnjz1v',
    name: 'Spreadsheet: Intermediate',
    tier: 'medium',
    skills: [{ key: 'spreadsheet', label: 'Spreadsheet', ratingKeys: ['Spreadsheet'] }]
  },
  {
    assessmentId: 'technical-assessment-bgwj2f5',
    name: 'Spreadsheet: Advanced',
    tier: 'hard',
    skills: [{ key: 'spreadsheet', label: 'Spreadsheet', ratingKeys: ['Spreadsheet'] }]
  },
  {
    assessmentId: 'technical-assessment-wfy3izl',
    name: 'Spreadsheet: Expert',
    tier: 'expert',
    skills: [{ key: 'spreadsheet', label: 'Spreadsheet', ratingKeys: ['Spreadsheet'] }]
  },
  {
    assessmentId: 'technical-assessment-07c3mr3',
    name: 'Bootstrap: Basic',
    tier: 'easy',
    skills: [{ key: 'bootstrap', label: 'Bootstrap', ratingKeys: ['Bootstrap'] }]
  },
  {
    assessmentId: 'technical-assessment-4yuh74c',
    name: 'Bootstrap: Intermediate',
    tier: 'medium',
    skills: [{ key: 'bootstrap', label: 'Bootstrap', ratingKeys: ['Bootstrap'] }]
  },
  {
    assessmentId: 'technical-assessment-zbk6d6m',
    name: 'Bootstrap: Advanced',
    tier: 'hard',
    skills: [{ key: 'bootstrap', label: 'Bootstrap', ratingKeys: ['Bootstrap'] }]
  },
  {
    assessmentId: 'technical-assessment-jv81kxf',
    name: 'Bootstrap: Expert',
    tier: 'expert',
    skills: [{ key: 'bootstrap', label: 'Bootstrap', ratingKeys: ['Bootstrap'] }]
  },
  {
    assessmentId: 'technical-assessment-tyk1kgp',
    name: 'Apache: Basic',
    tier: 'easy',
    skills: [{ key: 'apache', label: 'Apache', ratingKeys: ['Apache'] }]
  },
  {
    assessmentId: 'technical-assessment-d17iszj',
    name: 'Apache: Intermediate',
    tier: 'medium',
    skills: [{ key: 'apache', label: 'Apache', ratingKeys: ['Apache'] }]
  },
  {
    assessmentId: 'technical-assessment-wip72rf',
    name: 'Apache: Advanced',
    tier: 'hard',
    skills: [{ key: 'apache', label: 'Apache', ratingKeys: ['Apache'] }]
  },
  {
    assessmentId: 'technical-assessment-nu8h5vy',
    name: 'Apache: Expert',
    tier: 'expert',
    skills: [{ key: 'apache', label: 'Apache', ratingKeys: ['Apache'] }]
  },
  {
    assessmentId: 'technical-assessment-8pojhoj',
    name: 'Hash Table: Basic',
    tier: 'easy',
    skills: [{ key: 'hash-table', label: 'Hash Table', ratingKeys: ['Hash table', 'Hash Table'] }]
  },
  {
    assessmentId: 'technical-assessment-xmzssk3',
    name: 'Hash Table: Intermediate',
    tier: 'medium',
    skills: [{ key: 'hash-table', label: 'Hash Table', ratingKeys: ['Hash table', 'Hash Table'] }]
  },
  {
    assessmentId: 'technical-assessment-hl7usll',
    name: 'Hash Table: Advanced',
    tier: 'hard',
    skills: [{ key: 'hash-table', label: 'Hash Table', ratingKeys: ['Hash table', 'Hash Table'] }]
  },
  {
    assessmentId: 'technical-assessment-7es6jzr',
    name: 'Hash Table: Expert',
    tier: 'expert',
    skills: [{ key: 'hash-table', label: 'Hash Table', ratingKeys: ['Hash table', 'Hash Table'] }]
  },
  {
    assessmentId: 'technical-assessment-61biqn5',
    name: 'Manual Testing: Basic',
    tier: 'easy',
    skills: [{ key: 'manual', label: 'Manual Testing', ratingKeys: ['Manual', 'Manual Testing'] }]
  },
  {
    assessmentId: 'technical-assessment-mprcjt2',
    name: 'Manual Testing: Intermediate',
    tier: 'medium',
    skills: [{ key: 'manual', label: 'Manual Testing', ratingKeys: ['Manual', 'Manual Testing'] }]
  },
  {
    assessmentId: 'technical-assessment-dj2604k',
    name: 'Manual Testing: Advanced',
    tier: 'hard',
    skills: [{ key: 'manual', label: 'Manual Testing', ratingKeys: ['Manual', 'Manual Testing'] }]
  },
  {
    assessmentId: 'technical-assessment-886mbye',
    name: 'Manual Testing: Expert',
    tier: 'expert',
    skills: [{ key: 'manual', label: 'Manual Testing', ratingKeys: ['Manual', 'Manual Testing'] }]
  },
  {
    assessmentId: 'technical-assessment-pkcy76r',
    name: 'Debugging: Basic',
    tier: 'easy',
    skills: [{ key: 'debugging', label: 'Debugging', ratingKeys: ['Debugging'] }]
  },
  {
    assessmentId: 'technical-assessment-hm5ovfe',
    name: 'Debugging: Intermediate',
    tier: 'medium',
    skills: [{ key: 'debugging', label: 'Debugging', ratingKeys: ['Debugging'] }]
  },
  {
    assessmentId: 'technical-assessment-kmufds3',
    name: 'Debugging: Advanced',
    tier: 'hard',
    skills: [{ key: 'debugging', label: 'Debugging', ratingKeys: ['Debugging'] }]
  },
  {
    assessmentId: 'technical-assessment-j7bs49w',
    name: 'Debugging: Expert',
    tier: 'expert',
    skills: [{ key: 'debugging', label: 'Debugging', ratingKeys: ['Debugging'] }]
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
