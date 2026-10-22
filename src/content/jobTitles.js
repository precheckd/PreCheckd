// The fixed list of job titles a posting can use. Recruiters never type a title: they pick up to 3 skills
// first, and the titles below that cover ALL of those skills are offered. If none fits, the request goes to
// staff (Catalog Requests) and the posting waits. To add a title, add a line here.
//
// id:     stable key (never change once used on a posting)
// title:  what candidates see
// skills: the skill keys the title covers. A key only matters once a test exists for that skill (keys are
//         the ones in the skill catalog, e.g. 'linux', 'agile', 'cloud'); a title can list skills we have
//         not built tests for yet.

const TITLES = [
  // Support and IT operations
  { id: 'help-desk-technician', title: 'Help Desk Technician', skills: ['customer-support', 'windows', 'networking', 'ticketing'] },
  { id: 'it-support-specialist', title: 'IT Support Specialist', skills: ['customer-support', 'windows', 'linux', 'networking', 'ticketing'] },
  { id: 'desktop-support-engineer', title: 'Desktop Support Engineer', skills: ['windows', 'networking', 'customer-support', 'ticketing'] },
  { id: 'product-support-engineer', title: 'Product Support Engineer', skills: ['customer-support', 'linux', 'networking', 'security', 'sql', 'ticketing', 'cloud'] },
  { id: 'technical-support-engineer', title: 'Technical Support Engineer', skills: ['customer-support', 'linux', 'windows', 'networking', 'cloud', 'sql', 'ticketing'] },
  { id: 'systems-administrator', title: 'Systems Administrator', skills: ['linux', 'windows', 'networking', 'cloud', 'security', 'scripting'] },
  { id: 'linux-administrator', title: 'Linux Administrator', skills: ['linux', 'scripting', 'networking', 'security', 'cloud'] },
  { id: 'windows-administrator', title: 'Windows Administrator', skills: ['windows', 'networking', 'security', 'scripting'] },
  { id: 'network-administrator', title: 'Network Administrator', skills: ['networking', 'security', 'linux', 'windows'] },
  { id: 'network-engineer', title: 'Network Engineer', skills: ['networking', 'security', 'cloud', 'scripting'] },

  // Cloud and DevOps
  { id: 'cloud-engineer', title: 'Cloud Engineer', skills: ['cloud', 'linux', 'networking', 'security', 'scripting', 'devops'] },
  { id: 'cloud-support-engineer', title: 'Cloud Support Engineer', skills: ['cloud', 'linux', 'customer-support', 'networking', 'ticketing'] },
  { id: 'cloud-architect', title: 'Cloud Architect', skills: ['cloud', 'networking', 'security', 'devops', 'linux'] },
  { id: 'devops-engineer', title: 'DevOps Engineer', skills: ['devops', 'cloud', 'linux', 'scripting', 'agile', 'security'] },
  { id: 'site-reliability-engineer', title: 'Site Reliability Engineer', skills: ['devops', 'cloud', 'linux', 'scripting', 'networking'] },

  // Security
  { id: 'security-analyst', title: 'Security Analyst', skills: ['security', 'networking', 'linux', 'windows', 'scripting'] },
  { id: 'soc-analyst', title: 'SOC Analyst', skills: ['security', 'networking', 'linux', 'windows', 'ticketing'] },
  { id: 'cybersecurity-engineer', title: 'Cybersecurity Engineer', skills: ['security', 'cloud', 'networking', 'linux', 'scripting'] },
  { id: 'security-administrator', title: 'Security Administrator', skills: ['security', 'windows', 'linux', 'networking', 'cloud'] },
  { id: 'grc-analyst', title: 'GRC Analyst', skills: ['security', 'compliance', 'risk'] },
  { id: 'penetration-tester', title: 'Penetration Tester', skills: ['security', 'networking', 'linux', 'scripting'] },
  { id: 'incident-responder', title: 'Incident Responder', skills: ['security', 'linux', 'windows', 'networking', 'scripting'] },

  // Software and data
  { id: 'software-engineer', title: 'Software Engineer', skills: ['python', 'javascript', 'java', 'sql', 'git', 'agile', 'cloud', 'testing'] },
  { id: 'front-end-developer', title: 'Front-End Developer', skills: ['javascript', 'html-css', 'git', 'testing', 'agile'] },
  { id: 'back-end-developer', title: 'Back-End Developer', skills: ['python', 'javascript', 'java', 'sql', 'git', 'cloud', 'testing', 'agile'] },
  { id: 'full-stack-developer', title: 'Full-Stack Developer', skills: ['javascript', 'html-css', 'python', 'java', 'sql', 'git', 'cloud', 'testing', 'agile'] },
  { id: 'qa-engineer', title: 'QA Engineer', skills: ['testing', 'sql', 'scripting', 'agile', 'git'] },
  { id: 'database-administrator', title: 'Database Administrator', skills: ['sql', 'linux', 'windows', 'cloud', 'security', 'scripting'] },
  { id: 'data-analyst', title: 'Data Analyst', skills: ['sql', 'python', 'excel', 'data-visualization'] },
  { id: 'data-engineer', title: 'Data Engineer', skills: ['sql', 'python', 'cloud', 'scripting', 'git'] },

  // Project and delivery
  { id: 'project-manager', title: 'Project Manager', skills: ['project-management', 'agile', 'scrum', 'communication'] },
  { id: 'it-project-manager', title: 'IT Project Manager', skills: ['project-management', 'agile', 'scrum', 'cloud', 'security'] },
  { id: 'scrum-master', title: 'Scrum Master', skills: ['scrum', 'agile', 'project-management', 'communication'] },
  { id: 'agile-coach', title: 'Agile Coach', skills: ['agile', 'scrum', 'communication'] },
  { id: 'business-analyst', title: 'Business Analyst', skills: ['business-analysis', 'sql', 'agile', 'excel', 'communication'] },
  { id: 'product-owner', title: 'Product Owner', skills: ['agile', 'scrum', 'business-analysis', 'communication'] },
  { id: 'technical-program-manager', title: 'Technical Program Manager', skills: ['project-management', 'agile', 'cloud', 'communication'] },

  // Customer-facing technical roles
  { id: 'solutions-engineer', title: 'Solutions Engineer', skills: ['cloud', 'networking', 'security', 'sql', 'communication'] },
  { id: 'technical-account-manager', title: 'Technical Account Manager', skills: ['customer-support', 'cloud', 'security', 'communication', 'ticketing'] },
  { id: 'implementation-specialist', title: 'Implementation Specialist', skills: ['customer-support', 'sql', 'project-management', 'communication'] },
  { id: 'customer-success-manager', title: 'Customer Success Manager', skills: ['customer-support', 'communication', 'ticketing'] },
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
