// The fixed list of job titles a posting can use. Recruiters never type a title: they pick up to 3 skills
// first, and the titles below that cover ALL of those skills are offered. If none fits, the request goes to
// staff (Catalog Requests) and the posting waits. To add a title, add a line here.
//
// id:     stable key (never change once used on a posting)
// title:  what candidates see
// skills: skill keys the title covers. SKILL KEYS ARE CODERBYTE'S SKILL NAMES, lowercased with dashes
//         ('Active Directory' -> 'active-directory', 'Power BI' -> 'power-bi', 'C#' -> 'c-sharp').
//         Source: the Technology/skill list in the CoderByte test builder (Oct 22, 2026). A key only matters
//         once a test exists for that skill; a title can list skills we have not built tests for yet.

const TITLES = [
  // Support and IT operations
  { id: 'help-desk-technician', title: 'Help Desk Technician', skills: ['customer-support', 'active-directory', 'network', 'jira', 'servicenow', 'powershell', 'problem-solving'] },
  { id: 'it-support-specialist', title: 'IT Support Specialist', skills: ['customer-support', 'active-directory', 'linux', 'network', 'jira', 'servicenow', 'powershell', 'problem-solving'] },
  { id: 'desktop-support-engineer', title: 'Desktop Support Engineer', skills: ['active-directory', 'powershell', 'network', 'customer-support', 'jira', 'servicenow', 'problem-solving'] },
  { id: 'product-support-engineer', title: 'Product Support Engineer', skills: ['customer-support', 'linux', 'network', 'security', 'sql', 'jira', 'servicenow', 'cloud', 'problem-solving'] },
  { id: 'technical-support-engineer', title: 'Technical Support Engineer', skills: ['customer-support', 'linux', 'active-directory', 'network', 'cloud', 'sql', 'jira', 'servicenow', 'powershell'] },
  { id: 'systems-administrator', title: 'Systems Administrator', skills: ['linux', 'active-directory', 'network', 'cloud', 'security', 'powershell', 'python'] },
  { id: 'linux-administrator', title: 'Linux Administrator', skills: ['linux', 'unix', 'ubuntu', 'red-hat', 'python', 'network', 'security', 'cloud'] },
  { id: 'windows-administrator', title: 'Windows Administrator', skills: ['active-directory', 'powershell', 'network', 'security'] },
  { id: 'network-administrator', title: 'Network Administrator', skills: ['network', 'security', 'linux', 'active-directory'] },
  { id: 'network-engineer', title: 'Network Engineer', skills: ['network', 'security', 'cloud', 'python', 'powershell'] },

  // Cloud and DevOps
  { id: 'cloud-engineer', title: 'Cloud Engineer', skills: ['cloud', 'aws', 'azure', 'gcp', 'linux', 'network', 'security', 'python', 'docker', 'terraform'] },
  { id: 'cloud-support-engineer', title: 'Cloud Support Engineer', skills: ['cloud', 'aws', 'azure', 'gcp', 'linux', 'customer-support', 'network', 'jira', 'servicenow'] },
  { id: 'cloud-architect', title: 'Cloud Architect', skills: ['cloud', 'aws', 'azure', 'gcp', 'network', 'security', 'terraform', 'linux', 'system-design'] },
  { id: 'devops-engineer', title: 'DevOps Engineer', skills: ['cloud', 'aws', 'azure', 'gcp', 'linux', 'python', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'ci', 'agile', 'security'] },
  { id: 'site-reliability-engineer', title: 'Site Reliability Engineer', skills: ['cloud', 'aws', 'linux', 'python', 'docker', 'kubernetes', 'terraform', 'network'] },

  // Security
  { id: 'security-analyst', title: 'Security Analyst', skills: ['security', 'cybersecurity', 'network', 'linux', 'active-directory', 'python'] },
  { id: 'soc-analyst', title: 'SOC Analyst', skills: ['security', 'cybersecurity', 'network', 'linux', 'active-directory', 'mitre', 'jira', 'servicenow'] },
  { id: 'cybersecurity-engineer', title: 'Cybersecurity Engineer', skills: ['cybersecurity', 'security', 'cloud', 'network', 'linux', 'python'] },
  { id: 'security-administrator', title: 'Security Administrator', skills: ['security', 'cybersecurity', 'active-directory', 'linux', 'network', 'cloud'] },
  { id: 'grc-analyst', title: 'GRC Analyst', skills: ['security', 'cybersecurity', 'compliance', 'soc-2'] },
  { id: 'penetration-tester', title: 'Penetration Tester', skills: ['security', 'cybersecurity', 'owasp', 'network', 'linux', 'python'] },
  { id: 'incident-responder', title: 'Incident Responder', skills: ['security', 'cybersecurity', 'mitre', 'linux', 'active-directory', 'network', 'python'] },

  // Software and data
  { id: 'software-engineer', title: 'Software Engineer', skills: ['python', 'javascript', 'java', 'typescript', 'sql', 'git', 'agile', 'cloud', 'qa', 'algorithms', 'data-structures'] },
  { id: 'front-end-developer', title: 'Front-End Developer', skills: ['javascript', 'typescript', 'html', 'css', 'react', 'git', 'qa', 'agile'] },
  { id: 'back-end-developer', title: 'Back-End Developer', skills: ['python', 'javascript', 'java', 'sql', 'git', 'cloud', 'qa', 'agile', 'rest'] },
  { id: 'full-stack-developer', title: 'Full-Stack Developer', skills: ['javascript', 'typescript', 'html', 'css', 'react', 'python', 'java', 'sql', 'git', 'cloud', 'qa', 'agile', 'rest'] },
  { id: 'qa-engineer', title: 'QA Engineer', skills: ['qa', 'manual', 'selenium', 'cypress', 'playwright', 'sql', 'python', 'agile', 'git'] },
  { id: 'database-administrator', title: 'Database Administrator', skills: ['sql', 'mysql', 'postgresql', 't-sql', 'oracle', 'linux', 'cloud', 'security'] },
  { id: 'data-analyst', title: 'Data Analyst', skills: ['sql', 'python', 'excel', 'spreadsheet', 'tableau', 'power-bi', 'looker', 'statistics'] },
  { id: 'data-engineer', title: 'Data Engineer', skills: ['sql', 'python', 'cloud', 'git', 'etl', 'spark'] },

  // Project and delivery
  { id: 'scrum-master', title: 'Scrum Master', skills: ['agile', 'jira', 'english-proficiency'] },
  { id: 'agile-coach', title: 'Agile Coach', skills: ['agile', 'english-proficiency'] },
  { id: 'business-analyst', title: 'Business Analyst', skills: ['analyst', 'sql', 'agile', 'excel', 'jira', 'english-proficiency'] },
  { id: 'product-owner', title: 'Product Owner', skills: ['agile', 'analyst', 'jira', 'english-proficiency'] },

  // Customer-facing technical roles
  { id: 'solutions-engineer', title: 'Solutions Engineer', skills: ['cloud', 'network', 'security', 'sql', 'english-proficiency'] },
  { id: 'technical-account-manager', title: 'Technical Account Manager', skills: ['customer-support', 'customer-success', 'cloud', 'security', 'english-proficiency', 'jira'] },
  { id: 'implementation-specialist', title: 'Implementation Specialist', skills: ['customer-support', 'sql', 'english-proficiency'] },
  { id: 'customer-success-manager', title: 'Customer Success Manager', skills: ['customer-success', 'customer-support', 'english-proficiency'] },
];

const BY_ID = new Map(TITLES.map((t) => [t.id, t]));

function byId(id) { return BY_ID.get(id) || null; }

// Titles that cover every skill key given (so fewer picked skills means more titles to choose from).
// With no skills picked there is nothing to match, so nothing is offered.
function titlesForSkills(skillKeys) {
  const keys = [...new Set((skillKeys || []).filter(Boolean))];
  if (!keys.length) return [];
  return TITLES.filter((t) => keys.every((k) => t.skills.includes(k)))
    .sort((a, b) => a.skills.length - b.skills.length || a.title.localeCompare(b.title));
}

module.exports = { TITLES, byId, titlesForSkills };
