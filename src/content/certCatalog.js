// The fixed list of certifications a recruiter can require on a posting. A candidate's certification
// counts toward a posting only when its name matches an entry here (by display name or any alias) AND
// it is verified and not expired. Unlisted certifications still show on the profile; they just cannot
// be required by a posting. To add one, add a line here (id never changes once used on a posting).
//
// id:      stable key, lowercase with dashes
// name:    what recruiters and candidates see
// aliases: other ways the same credential is written (including Credly badge titles)

const CATALOG = [
  // Security
  { id: 'comptia-security-plus', name: 'CompTIA Security+', aliases: ['Security+', 'Security Plus', 'CompTIA Security+ ce', 'CompTIA Security+ Certification', 'Sec+'] },
  { id: 'comptia-network-plus', name: 'CompTIA Network+', aliases: ['Network+', 'Network Plus', 'CompTIA Network+ ce', 'CompTIA Network+ Certification'] },
  { id: 'comptia-a-plus', name: 'CompTIA A+', aliases: ['A+', 'A Plus', 'CompTIA A+ ce', 'CompTIA A+ Certification', 'CompTIA A+ Core 1', 'CompTIA A+ Core 2'] },
  { id: 'comptia-linux-plus', name: 'CompTIA Linux+', aliases: ['Linux+', 'CompTIA Linux+ ce'] },
  { id: 'comptia-cysa-plus', name: 'CompTIA CySA+', aliases: ['CySA+', 'CompTIA Cybersecurity Analyst (CySA+)', 'CompTIA CySA+ ce'] },
  { id: 'comptia-pentest-plus', name: 'CompTIA PenTest+', aliases: ['PenTest+', 'Pentest Plus', 'CompTIA PenTest+ ce'] },
  { id: 'comptia-casp-plus', name: 'CompTIA CASP+', aliases: ['CASP+', 'CompTIA Advanced Security Practitioner (CASP+)', 'CompTIA SecurityX'] },
  { id: 'isc2-cissp', name: 'CISSP', aliases: ['Certified Information Systems Security Professional', 'Certified Information Systems Security Professional (CISSP)', 'ISC2 CISSP'] },
  { id: 'isc2-ccsp', name: 'CCSP', aliases: ['Certified Cloud Security Professional', 'Certified Cloud Security Professional (CCSP)'] },
  { id: 'isc2-cc', name: 'ISC2 Certified in Cybersecurity (CC)', aliases: ['Certified in Cybersecurity', 'Certified in Cybersecurity (CC)', 'ISC2 CC'] },
  { id: 'isaca-cism', name: 'CISM', aliases: ['Certified Information Security Manager', 'Certified Information Security Manager (CISM)'] },
  { id: 'isaca-cisa', name: 'CISA', aliases: ['Certified Information Systems Auditor', 'Certified Information Systems Auditor (CISA)'] },
  { id: 'eccouncil-ceh', name: 'Certified Ethical Hacker (CEH)', aliases: ['CEH', 'Certified Ethical Hacker', 'EC-Council Certified Ethical Hacker'] },
  { id: 'offsec-oscp', name: 'OSCP', aliases: ['Offensive Security Certified Professional', 'OSCP+'] },
  { id: 'giac-gsec', name: 'GIAC Security Essentials (GSEC)', aliases: ['GSEC', 'GIAC Security Essentials'] },
  { id: 'google-cybersecurity', name: 'Google Cybersecurity Certificate', aliases: ['Google Cybersecurity Professional Certificate', 'Google Cybersecurity'] },
  { id: 'google-it-support', name: 'Google IT Support Certificate', aliases: ['Google IT Support Professional Certificate', 'Google IT Support'] },
  { id: 'proofpoint-ctpa', name: 'Proofpoint Certified Threat Protection Administrator', aliases: ['Proofpoint Certified Threat Protection Administrator (PCTPA)', 'Proofpoint Threat Protection Administrator'] },

  // Cloud
  { id: 'aws-cloud-practitioner', name: 'AWS Certified Cloud Practitioner', aliases: ['AWS Cloud Practitioner', 'Cloud Practitioner'] },
  { id: 'aws-solutions-architect-associate', name: 'AWS Certified Solutions Architect - Associate', aliases: ['AWS Solutions Architect Associate', 'AWS Certified Solutions Architect Associate', 'AWS Certified Solutions Architect – Associate'] },
  { id: 'aws-solutions-architect-professional', name: 'AWS Certified Solutions Architect - Professional', aliases: ['AWS Solutions Architect Professional', 'AWS Certified Solutions Architect Professional', 'AWS Certified Solutions Architect – Professional'] },
  { id: 'aws-developer-associate', name: 'AWS Certified Developer - Associate', aliases: ['AWS Developer Associate', 'AWS Certified Developer Associate', 'AWS Certified Developer – Associate'] },
  { id: 'aws-sysops-administrator-associate', name: 'AWS Certified SysOps Administrator - Associate', aliases: ['AWS SysOps Administrator Associate', 'AWS Certified SysOps Administrator Associate', 'AWS Certified CloudOps Engineer - Associate'] },
  { id: 'aws-security-specialty', name: 'AWS Certified Security - Specialty', aliases: ['AWS Security Specialty', 'AWS Certified Security Specialty'] },
  { id: 'azure-fundamentals', name: 'Microsoft Azure Fundamentals (AZ-900)', aliases: ['Microsoft Certified: Azure Fundamentals', 'AZ-900', 'Azure Fundamentals'] },
  { id: 'azure-administrator', name: 'Microsoft Azure Administrator (AZ-104)', aliases: ['Microsoft Certified: Azure Administrator Associate', 'AZ-104', 'Azure Administrator Associate'] },
  { id: 'azure-developer', name: 'Microsoft Azure Developer (AZ-204)', aliases: ['Microsoft Certified: Azure Developer Associate', 'AZ-204', 'Azure Developer Associate'] },
  { id: 'azure-security-engineer', name: 'Microsoft Azure Security Engineer (AZ-500)', aliases: ['Microsoft Certified: Azure Security Engineer Associate', 'AZ-500', 'Azure Security Engineer Associate'] },
  { id: 'microsoft-security-fundamentals', name: 'Microsoft Security, Compliance, and Identity Fundamentals (SC-900)', aliases: ['Microsoft Certified: Security, Compliance, and Identity Fundamentals', 'SC-900'] },
  { id: 'gcp-associate-cloud-engineer', name: 'Google Cloud Associate Cloud Engineer', aliases: ['Associate Cloud Engineer', 'Google Associate Cloud Engineer'] },
  { id: 'gcp-professional-cloud-architect', name: 'Google Cloud Professional Cloud Architect', aliases: ['Professional Cloud Architect', 'Google Professional Cloud Architect'] },

  // Networking, systems, DevOps
  { id: 'cisco-ccna', name: 'Cisco CCNA', aliases: ['CCNA', 'Cisco Certified Network Associate', 'Cisco Certified Network Associate (CCNA)'] },
  { id: 'cisco-ccnp-enterprise', name: 'Cisco CCNP Enterprise', aliases: ['CCNP Enterprise'] },
  { id: 'redhat-rhcsa', name: 'Red Hat Certified System Administrator (RHCSA)', aliases: ['RHCSA', 'Red Hat Certified System Administrator'] },
  { id: 'lpi-lpic-1', name: 'LPIC-1', aliases: ['LPI Linux Administrator', 'LPIC-1: Linux Administrator'] },
  { id: 'cncf-cka', name: 'Certified Kubernetes Administrator (CKA)', aliases: ['CKA', 'Certified Kubernetes Administrator'] },
  { id: 'cncf-ckad', name: 'Certified Kubernetes Application Developer (CKAD)', aliases: ['CKAD', 'Certified Kubernetes Application Developer'] },
  { id: 'hashicorp-terraform-associate', name: 'HashiCorp Certified: Terraform Associate', aliases: ['Terraform Associate', 'HashiCorp Terraform Associate', 'HashiCorp Certified Terraform Associate'] },
  { id: 'splunk-core-user', name: 'Splunk Core Certified User', aliases: ['Splunk Core User'] },

  // Project, process and agile
  { id: 'pmi-pmp', name: 'Project Management Professional (PMP)', aliases: ['PMP', 'Project Management Professional'] },
  { id: 'pmi-capm', name: 'Certified Associate in Project Management (CAPM)', aliases: ['CAPM', 'Certified Associate in Project Management'] },
  { id: 'scrum-alliance-csm', name: 'Certified ScrumMaster (CSM)', aliases: ['CSM', 'Certified ScrumMaster', 'Certified Scrum Master', 'Scrum Master', 'Scrum Master Certified'] },
  { id: 'scrum-org-psm-1', name: 'Professional Scrum Master I (PSM I)', aliases: ['PSM I', 'PSM 1', 'Professional Scrum Master I', 'Professional Scrum Master'] },
  { id: 'scaled-agile-safe-agilist', name: 'SAFe Agilist (SA)', aliases: ['SAFe 6 Agilist', 'SAFe 5 Agilist', 'SAFe Agilist', 'Certified SAFe Agilist', 'Leading SAFe', 'SAFe 6 Certified Agilist'] },
  { id: 'axelos-itil-4-foundation', name: 'ITIL 4 Foundation', aliases: ['ITIL Foundation', 'ITIL 4 Foundation Certificate', 'ITIL V4 Foundation'] },
  { id: 'six-sigma-green-belt', name: 'Six Sigma Green Belt', aliases: ['Lean Six Sigma Green Belt', 'Certified Six Sigma Green Belt'] },
];

// "Security+" and "Security Plus" must read the same, and punctuation or case must not matter.
function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, '');
}

const BY_NORMALIZED = new Map();
for (const entry of CATALOG) {
  for (const label of [entry.name, ...entry.aliases]) BY_NORMALIZED.set(normalize(label), entry.id);
}
const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

// The catalog id for a certification name a candidate typed or Credly supplied, or null.
function catalogIdFor(name) {
  return BY_NORMALIZED.get(normalize(name)) || null;
}

function byId(id) { return BY_ID.get(id) || null; }

// For the recruiter's picker and the candidate's name suggestions.
function search(query, limit = 10) {
  const q = normalize(query);
  if (!q) return CATALOG.slice(0, limit);
  return CATALOG.filter((c) => [c.name, ...c.aliases].some((l) => normalize(l).includes(q))).slice(0, limit);
}

module.exports = { CATALOG, catalogIdFor, byId, search, normalize };
