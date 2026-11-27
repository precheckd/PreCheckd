// Sample data for the demo site (demo.precheckd.com). Pure: builds plain objects, touches no database.
// Everything here is made up: names are random combinations, companies are invented, emails end in
// @demo.invalid (which can never be delivered) and phone numbers are in the reserved fictional 555-01xx range.
// Dates are relative to `now`, so the nightly reset always produces fresh-looking data.
const { ROLES } = require('../content/roles');
const { seniorityLabel } = require('../services/postingValidation');
const demo = require('../config/demo');

const DAY = 86400000;

// Small deterministic random generator, so the same night always produces the same demo.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SKILLS = {
  aws: 'AWS', cloud: 'Cloud', python: 'Python', linux: 'Linux', bash: 'Bash', git: 'Git', security: 'Security',
  network: 'Networking', pentest: 'Penetration testing', 'manual-testing': 'Manual testing', 'active-directory': 'Active Directory',
  'system-design': 'System design', sql: 'SQL', excel: 'Excel', spreadsheet: 'Spreadsheets', tableau: 'Tableau', agile: 'Agile',
  api: 'APIs', azure: 'Azure',
};

const CITIES = [
  { city: 'Raleigh', state: 'NC', lng: -78.64, lat: 35.78 }, { city: 'Charlotte', state: 'NC', lng: -80.84, lat: 35.23 },
  { city: 'Atlanta', state: 'GA', lng: -84.39, lat: 33.75 }, { city: 'New York', state: 'NY', lng: -74.0, lat: 40.71 },
  { city: 'Boston', state: 'MA', lng: -71.06, lat: 42.36 }, { city: 'Chicago', state: 'IL', lng: -87.63, lat: 41.88 },
  { city: 'Austin', state: 'TX', lng: -97.74, lat: 30.27 }, { city: 'Denver', state: 'CO', lng: -104.99, lat: 39.74 },
  { city: 'Seattle', state: 'WA', lng: -122.33, lat: 47.61 }, { city: 'Phoenix', state: 'AZ', lng: -112.07, lat: 33.45 },
  { city: 'Columbus', state: 'OH', lng: -82.99, lat: 39.96 }, { city: 'Tampa', state: 'FL', lng: -82.46, lat: 27.95 },
];

const PERSONAS = [
  { key: 'cloud', titles: ['Cloud Support Engineer', 'DevOps Engineer', 'Senior DevOps Engineer'], skills: ['aws', 'cloud', 'python', 'linux', 'bash', 'git'],
    certs: ['AWS Certified Cloud Practitioner', 'AWS Certified Solutions Architect - Associate', 'HashiCorp Terraform Associate'], degree: ['B.S. Computer Science', 'bachelor'] },
  { key: 'security', titles: ['IT Security Analyst', 'Security Engineer', 'Senior Security Engineer'], skills: ['security', 'network', 'linux', 'pentest', 'bash'],
    certs: ['CompTIA Security+', 'CompTIA Network+', 'Certified Ethical Hacker'], degree: ['B.S. Cybersecurity', 'bachelor'] },
  { key: 'support', titles: ['Help Desk Technician', 'Technical Support Engineer', 'Senior Support Engineer'], skills: ['manual-testing', 'linux', 'active-directory', 'network', 'system-design'],
    certs: ['CompTIA A+', 'Microsoft 365 Certified: Fundamentals'], degree: ['A.A.S. Information Technology', 'associate'] },
  { key: 'data', titles: ['Reporting Analyst', 'Data Analyst', 'Senior Data Analyst'], skills: ['sql', 'excel', 'spreadsheet', 'tableau', 'python'],
    certs: ['Google Data Analytics Certificate'], degree: ['B.S. Statistics', 'bachelor'] },
  { key: 'pm', titles: ['Project Coordinator', 'Project Manager', 'Senior Project Manager'], skills: ['agile', 'spreadsheet', 'excel'],
    certs: ['Certified ScrumMaster', 'Project Management Professional (PMP)'], degree: ['B.A. Business Administration', 'bachelor'] },
  { key: 'dev', titles: ['Software Developer', 'Back-end Developer', 'Senior Back-end Developer'], skills: ['api', 'sql', 'git', 'system-design', 'python', 'linux'],
    certs: ['AWS Certified Developer - Associate'], degree: ['B.S. Computer Science', 'bachelor'] },
];

const FIRST = ['Maya', 'Daniel', 'Priya', 'Marcus', 'Elena', 'Jamal', 'Hannah', 'Luis', 'Aisha', 'Ethan', 'Grace', 'Omar', 'Sofia', 'Noah', 'Lena', 'Victor', 'Tessa', 'Andre', 'Nora', 'Caleb',
  'Ines', 'Devon', 'Mei', 'Rafael', 'Willa', 'Isaac', 'Camila', 'Theo', 'Zara', 'Miles', 'Rosa', 'Jonah', 'Amara', 'Felix', 'Dana', 'Kofi'];
const LAST = ['Alvarez', 'Brennan', 'Chowdhury', 'Dalton', 'Ellison', 'Fairbanks', 'Gallagher', 'Hartwell', 'Ibrahim', 'Jensen', 'Kowalski', 'Lindqvist', 'Mbeki', 'Navarro', 'Oyelaran',
  'Pemberton', 'Quigley', 'Radcliffe', 'Santoro', 'Thornton', 'Underhill', 'Vasquez', 'Whitaker', 'Xiong', 'Yamamoto', 'Zimmerman', 'Abernathy', 'Bianchi', 'Castellanos', 'Donovan',
  'Eriksen', 'Fontaine', 'Grayson', 'Holloway', 'Iverson', 'Jaramillo'];

const EMPLOYERS = ['Harborview Logistics', 'Summit Ridge Health', 'Bluebird Credit Union', 'Ironwood Manufacturing', 'Lakeshore Insurance Group', 'Pinecrest Software',
  'Redwood Retail Group', 'Atlas Freight Systems', 'Cobalt Networks', 'Northfield Bank', 'Evergreen Energy Co.', 'Brightwater Media', 'Copperline Telecom', 'Sterling Pharma Labs'];

const LEVELS = ['Foundational', 'Intermediate', 'Advanced', 'Expert'];
const SCORE = { Foundational: 72, Intermediate: 82, Advanced: 90, Expert: 97 };
const TIERS = {
  Foundational: { easy: { right: 8, total: 10 } },
  Intermediate: { easy: { right: 10, total: 10 }, medium: { right: 8, total: 10 } },
  Advanced: { easy: { right: 10, total: 10 }, medium: { right: 9, total: 10 }, hard: { right: 8, total: 10 } },
  Expert: { easy: { right: 10, total: 10 }, medium: { right: 10, total: 10 }, hard: { right: 9, total: 10 }, expert: { right: 19, total: 20 } },
};

const pick = (r, list) => list[Math.floor(r() * list.length)];
const polygon = (c, d = 0.35) => ({ type: 'MultiPolygon', coordinates: [[[[c.lng - d, c.lat - d], [c.lng + d, c.lat - d], [c.lng + d, c.lat + d], [c.lng - d, c.lat + d], [c.lng - d, c.lat - d]]]] });
const phone = (n) => `+1202555${String(100 + n).padStart(4, '0')}`;
const ym = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

// One candidate. seniority 0 junior, 1 mid, 2 senior.
function candidateDoc({ n, first, last, email, persona, seniority, r, now, city }) {
  const slug = `${first}-${last}-${n}`.toLowerCase();
  const titles = persona.titles;
  const start = (yearsAgo) => ym(new Date(now - yearsAgo * 365 * DAY));
  const history = [];
  const spans = seniority === 0 ? [[3, 1.2, 0], [1.2, null, 0]] : seniority === 1 ? [[8, 4, 0], [4, 1.5, 1], [1.5, null, 1]] : [[14, 9, 0], [9, 4, 1], [4, null, 2]];
  spans.forEach(([from, to, level], i) => history.push({
    employerName: EMPLOYERS[(n + i * 5) % EMPLOYERS.length], jobTitle: titles[level],
    startDate: start(from), endDate: to ? start(to) : null, verified: r() > 0.35, verifiedAt: new Date(now - 20 * DAY),
  }));
  const certs = persona.certs.filter(() => r() > 0.35);
  if (!certs.length) certs.push(persona.certs[0]);
  const salary = [58000, 82000, 112000][seniority] + Math.round(r() * 12) * 2500;
  const arrangements = ['remote', 'hybrid', 'in_office'].filter(() => r() > 0.45);
  if (!arrangements.length) arrangements.push('hybrid');
  const doc = {
    firstName: first, lastName: last, slug, email, phone: phone(n),
    bio: `${titles[seniority]} with ${[3, 7, 13][seniority]}+ years of experience. Sample profile for the PreCheckd demo.`,
    isPhoneVerified: true, phoneVerifiedAt: new Date(now - 60 * DAY), emailVerifiedAt: new Date(now - 60 * DAY), termsAcceptedAt: new Date(now - 60 * DAY),
    isIdentityVerified: true, identityVerifiedAt: new Date(now - 59 * DAY), status: 'candidate', fullVerificationComplete: true,
    openToOpportunities: true, onboarding: { required: false, completedAt: new Date(now - 58 * DAY) },
    workHistory: history,
    educationHistory: [{ schoolName: pick(r, ['State University', 'Coastal Community College', 'Valley Technical Institute', 'Lakeview University']), degree: persona.degree[0], level: persona.degree[1], graduationDate: start([5, 9, 15][seniority]), verified: true, verifiedAt: new Date(now - 30 * DAY) }],
    certifications: certs.map((name) => ({ name, verified: r() > 0.3, verifiedAt: new Date(now - 25 * DAY), credentialId: null, expiresAt: null })),
    workAreas: polygon(city), minSalaryAmount: salary, minSalaryType: 'annual', workArrangement: arrangements,
    noticePeriod: pick(r, ['immediately_available', 'two_weeks', 'currently_employed_flexible']),
    showSkillBreakdown: r() > 0.6,
    billing: { status: 'active', plan: 'monthly', memberSince: new Date(now - 60 * DAY), currentPeriodEnd: new Date(now + 20 * DAY) },
  };
  // Every demo candidate shows as fully verified (keeps the random draws above unchanged).
  doc.facialRecognitionVerifiedAt = new Date(now - 59 * DAY);
  doc.workHistory.forEach((w) => { w.verified = true; });
  doc.certifications.forEach((c) => { c.verified = true; });
  // Skills they were tested on; a few results are Developing, which recruiters never see.
  const levelPool = [['Foundational', 'Intermediate'], ['Intermediate', 'Advanced'], ['Advanced', 'Expert']][seniority];
  const results = [];
  let chosen = persona.skills.filter(() => r() > 0.22);
  if (chosen.length < 3) chosen = persona.skills.slice(0, 3);
  chosen.forEach((key, i) => {
    const level = chosen.length >= 4 && i === chosen.length - 1 && r() > 0.5 ? 'Developing' : (i === 0 && seniority === 2 && r() > 0.5 ? 'Expert' : pick(r, levelPool));
    results.push({
      assessmentId: `demo-${key}`, inviteRef: `demo-${n}-${key}`, status: 'completed', completedAt: new Date(now - (20 + Math.floor(r() * 240)) * DAY),
      skills: [{ key, label: SKILLS[key], score: level === 'Developing' ? 48 : SCORE[level], weighted: true, level, tiers: level === 'Developing' ? { easy: { right: 5, total: 10 } } : TIERS[level] }],
      overallScore: level === 'Developing' ? 48 : SCORE[level], held: false,
    });
  });
  return { doc, results, persona: persona.key, seniority };
}

function build(now = Date.now()) {
  const r = rng(20261118);

  const skillAssessments = Object.entries(SKILLS).map(([key, label]) => ({
    assessmentId: `demo-${key}`, name: label, kind: 'skill', publicUrl: 'https://example.com/demo', skills: [{ key, label, ratingKeys: [label] }], active: true,
  }));

  const recruiters = [
    { key: 'jordan', firstName: 'Jordan', lastName: 'Rivers', company: 'Northbridge Talent Partners', email: demo.RECRUITER_EMAIL },
    { key: 'taylor', firstName: 'Taylor', lastName: 'Brooks', company: 'Cedar & Pine Staffing', email: 'taylor@demo.invalid' },
    { key: 'sam', firstName: 'Sam', lastName: 'Okafor', company: 'Lakeline Search Group', email: 'sam@demo.invalid' },
  ].map((x, i) => ({
    ...x, slug: `${x.firstName}-${x.lastName}-demo`.toLowerCase(), phone: phone(90 + i),
    bio: 'Sample recruiter for the PreCheckd demo.', accountTier: 'standard', isActive: true, isPhoneVerified: true, isIdentityVerified: true,
    phoneVerifiedAt: new Date(now - 90 * DAY), identityVerifiedAt: new Date(now - 90 * DAY), emailVerifiedAt: new Date(now - 90 * DAY),
    domainVerifiedAt: new Date(now - 90 * DAY), termsAcceptedAt: new Date(now - 90 * DAY),
    billing: { status: 'active', plan: 'annual', memberSince: new Date(now - 90 * DAY), currentPeriodEnd: new Date(now + 270 * DAY),
      founding: { wave: 1, priceCents: 24900, locked: true, lockedAt: new Date(now - 90 * DAY) } },
  }));

  const candidates = [];
  for (let n = 0; n < 36; n += 1) {
    candidates.push(candidateDoc({
      n, first: FIRST[n], last: LAST[(n * 7 + 3) % LAST.length], email: `candidate${n + 1}@demo.invalid`,
      persona: PERSONAS[n % PERSONAS.length], seniority: [0, 1, 2, 1, 0, 2, 1, 1, 2][n % 9], r, now, city: CITIES[n % CITIES.length],
    }));
  }
  // The shared demo candidate.
  const casey = candidateDoc({ n: 60, first: 'Casey', last: 'Morgan', email: demo.CANDIDATE_EMAIL, persona: PERSONAS[0], seniority: 1, r, now, city: CITIES[0] });
  casey.doc.workArrangement = ['hybrid', 'remote'];
  casey.doc.bio = 'DevOps engineer with 7+ years of experience. This is the sample candidate account for the PreCheckd demo.';
  casey.isDemoCandidate = true;
  // The demo is read-only, so nobody can switch the public verification page on. Ship it on, with every section shown.
  casey.doc.publicVerifyPage = true;
  casey.doc.publicSections = { certifications: true, degrees: true, jobTitles: true };
  candidates.push(casey);

  const day = (n) => new Date(Date.UTC(new Date(now + n * DAY).getUTCFullYear(), new Date(now + n * DAY).getUTCMonth(), new Date(now + n * DAY).getUTCDate()));
  const endOfDay = (n) => new Date(day(n).getTime() + DAY - 1000);
  const role = (id) => ROLES.find((x) => x.id === id);
  const sk = (list) => list.map(([key, minLevel]) => ({ key, label: SKILLS[key], minLevel }));

  // [recruiter, role, company, [city index, arrangement], pay, skills, summary, responsibilities]
  const defs = [
    ['jordan', 'devops-aws', 'Harborview Logistics', [0, 'hybrid'], ['salary', 95000, 120000], sk([['aws', 'Intermediate'], ['cloud', 'Intermediate'], ['python', 'Foundational']]),
      'Own the cloud platform behind our warehouse and shipping systems. You will automate deployments, keep costs in check and be the person the engineering team calls when something breaks at 2 a.m.',
      ['Build and maintain AWS infrastructure as code', 'Improve deployment pipelines and monitoring', 'Respond to incidents and write up what we learned', 'Work with developers on security and cost']],
    ['jordan', 'network-engineer', 'Atlas Freight Systems', [2, 'onsite'], ['salary', 85000, 105000], sk([['network', 'Intermediate'], ['linux', 'Intermediate'], ['security', 'Foundational']]),
      'Run the network across our distribution centers. Hands-on work with switches, firewalls and the people who depend on them.',
      ['Design, configure and troubleshoot LAN, WAN and wireless', 'Keep firewalls and VPNs patched and documented', 'Plan upgrades with minimal downtime']],
    ['jordan', 'cybersecurity', 'Lakeshore Insurance Group', [3, 'remote'], ['salary', 110000, 140000], sk([['security', 'Advanced'], ['network', 'Intermediate'], ['linux', 'Intermediate']]),
      'Protect customer and claims data for a regional insurer. You will watch alerts, run vulnerability scans and help the business say yes to new tools safely.',
      ['Triage and investigate security alerts', 'Run vulnerability scans and track fixes', 'Help teams review new vendors and software']],
    ['jordan', 'technical-support-engineer', 'Pinecrest Software', [1, 'remote_in_area'], ['salary', 70000, 90000], sk([['manual-testing', 'Foundational'], ['linux', 'Foundational'], ['system-design', 'Foundational']]),
      'Help customers of our business software get unstuck, and turn what you learn into fixes. Remote for people living in the Carolinas or Virginia.',
      ['Answer technical tickets and calls from customers', 'Reproduce and document bugs for engineering', 'Write help articles from real cases']],
    ['taylor', 'data-analyst-sql', 'Bluebird Credit Union', [1, 'hybrid'], ['hourly', 38, 48], sk([['sql', 'Intermediate'], ['tableau', 'Foundational'], ['excel', 'Intermediate']]),
      'Contract-to-hire analyst for our lending team. You will turn loan data into dashboards the branch managers actually use.',
      ['Write SQL to answer questions from lending and risk', 'Build and maintain Tableau dashboards', 'Present findings to non-technical teams']],
    ['taylor', 'project-manager-agile', 'Summit Ridge Health', [4, 'hybrid'], ['salary', 100000, 125000], sk([['agile', 'Advanced'], ['spreadsheet', 'Intermediate']]),
      'Lead cross-team projects for a regional health network, from kickoff to go-live.',
      ['Plan sprints and keep delivery on schedule', 'Manage stakeholders, risks and budgets', 'Run retrospectives that lead to real changes']],
    ['taylor', 'financial-analyst', 'Redwood Retail Group', [5, 'onsite'], ['salary', 80000, 100000], sk([['excel', 'Advanced'], ['sql', 'Intermediate'], ['spreadsheet', 'Intermediate']]),
      'Join the finance team behind a growing retail chain: forecasting, month-end reporting and store-level analysis.',
      ['Build forecasts and variance reports', 'Support month-end close', 'Analyze store performance']],
    ['sam', 'back-end-developer', 'Ironwood Software', [6, 'remote'], ['salary', 120000, 150000], sk([['api', 'Advanced'], ['sql', 'Intermediate'], ['system-design', 'Intermediate'], ['git', 'Intermediate']]),
      'Build the services behind our manufacturing analytics product. Small team, real ownership, no meetings for the sake of meetings.',
      ['Design and ship APIs used by our web and mobile apps', 'Keep database queries fast', 'Review code and mentor newer developers']],
    ['sam', 'azure-devops', 'Skyline Cloud Services', [8, 'hybrid'], ['salary', 125000, 155000], sk([['azure', 'Advanced'], ['active-directory', 'Intermediate']]),
      'Run Azure environments for mid-size clients, from identity to deployment pipelines.',
      ['Manage Azure subscriptions, identity and policy', 'Build and improve CI/CD pipelines', 'Advise clients on cost and security']],
  ];

  const postings = defs.map(([recruiterKey, roleId, company, [cityIx, arrangement], [payType, lo, hi], skills, summary, responsibilities], i) => {
    const c = CITIES[cityIx];
    const rr = role(roleId);
    const posting = {
      recruiterKey, titleId: roleId, title: rr.title, skills, seniorityLabel: seniorityLabel(skills), hiringCompany: company,
      companyWebsite: '', authorizedToRecruit: true, employmentType: roleId === 'data-analyst-sql' ? 'contract' : 'full_time',
      contractLength: roleId === 'data-analyst-sql' ? '6 months, with a path to full-time' : '', openings: 1 + (i % 3 === 0 ? 1 : 0),
      arrangement, inOfficeDays: arrangement === 'hybrid' ? 3 : null, relocation: false, travel: 'none', shift: 'daytime', shifts: ['daytime'],
      displayCity: arrangement === 'remote_in_area' ? '' : c.city, displayState: arrangement === 'remote_in_area' ? '' : c.state,
      areaRule: arrangement === 'remote_in_area' ? { states: ['NC', 'SC', 'VA'] } : { point: [c.lng, c.lat], radiusMiles: 50 },
      areaLabel: arrangement === 'remote_in_area' ? 'NC, SC and VA' : '',
      areaReason: arrangement === 'remote_in_area' ? 'states' : null,
      basePayType: payType, baseMin: lo, baseMax: hi, payBasis: ['skill_level', 'pay_band'],
      benefits: ['health', 'dental', 'vision', '401k_match', 'pto', 'paid_holidays'], goodFaithAt: new Date(now - (3 + i) * DAY),
      startDate: day(35 + i), startFirm: false, closeDate: endOfDay(30 + i * 3), requirementsAttestedAt: new Date(now - (3 + i) * DAY),
      summary, responsibilities, createdAt: new Date(now - (3 + i) * DAY),
      finalistTopics: i === 0 ? ['logic', 'problem', 'detail'] : [],
    };
    return posting;
  });

  // Applicants: spread the candidates over the first recruiter's postings (the demo recruiter's applicant pages).
  const applications = [];
  const statuses = ['applied', 'applied', 'applied', 'screening', 'interviewing', 'applied', 'offer'];
  postings.forEach((p, pi) => {
    const count = p.recruiterKey === 'jordan' ? 5 + (pi % 3) : 3;
    for (let k = 0; k < count; k += 1) {
      const candIx = (pi * 5 + k * 4) % 36;
      applications.push({ postingIx: pi, candidateIx: candIx, status: statuses[(pi + k) % statuses.length], appliedAt: new Date(now - (1 + ((pi + k * 2) % 12)) * DAY) });
    }
  });
  // The demo candidate has one application in progress.
  applications.push({ postingIx: 0, candidateIx: 36, status: 'screening', appliedAt: new Date(now - 4 * DAY) });

  // Connections for the demo recruiter: two accepted with full access granted, one waiting on the candidate.
  const connections = [
    { candidateIx: 2, status: 'accepted', full: true, note: 'Your skills look like a strong fit for a cloud role I am filling.' },
    { candidateIx: 8, status: 'accepted', full: true, note: 'I have a security opening that matches your profile.' },
    { candidateIx: 14, status: 'pending', full: false, note: 'Would you be open to a conversation about a hybrid role in your area?' },
  ];

  // Sample job test scores per posting (by applicant order) and finalist tests on the first posting.
  const jobTestScores = { 0: [92, 85, 78, 71, 64], 1: [88, 81, 74, 69, 60, 55], 2: [95, 90, 83, 76, 70, 62, 58], 3: [86, 79, 72, 66, 59] };
  const finalists = { 0: [
    { status: 'completed', hoursAgo: 30, score: 88, topicScores: [{ key: 'logic', score: 90 }, { key: 'problem', score: 85 }, { key: 'detail', score: 89 }] },
    { status: 'sent', hoursAgo: 20 },
    { status: 'expired', hoursAgo: 100 },
  ] };
  return { skillAssessments, recruiters, candidates, postings, applications, connections, jobTestScores, finalists };
}

module.exports = { build, SKILLS, CITIES, PERSONAS, phone };
