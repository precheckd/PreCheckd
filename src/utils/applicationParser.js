// Rules-based reading of job-application mail for the candidate tracker
// (roadmap #5). Pure functions, no database, nothing leaves our system.
//
//   parseMail({ fromAddress, fromName, subject, textBody })
//     -> { kind, company, role, ats, confidence } | null
//   kind: application_received | interview_request | assessment_request |
//         rejection | offer
//   matchApplication(mail, applications) -> the one entry this mail is about, or null
//
// Rules are tuned to be cautious: a missed message costs the member one click
// to add it by hand, while a wrong one is a wrong suggestion, so anything
// unclear returns null. Every result is only ever a SUGGESTION the member
// confirms; nothing here changes a tracker entry by itself.

const STATUS_FOR_KIND = {
  application_received: 'applied',
  assessment_request: 'screening',
  interview_request: 'interviewing',
  offer: 'offer',
  rejection: 'rejected'
};

// Shared applicant-tracking-system sending domains: mail from them says nothing
// about the employer's own domain, so the company comes from the text instead.
const ATS_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'hire.lever.co', 'myworkday.com', 'myworkdayjobs.com',
  'workday.com', 'ashbyhq.com', 'icims.com', 'smartrecruiters.com', 'jobvite.com', 'workable.com',
  'bamboohr.com', 'taleo.net', 'breezy.hr', 'recruitee.com', 'teamtailor.com', 'successfactors.com',
  'successfactors.eu', 'oraclecloud.com', 'paylocity.com', 'adp.com', 'ultipro.com', 'dayforce.com',
  'applytojob.com', 'jazz.co', 'rippling.com', 'gem.com', 'hirehive.com', 'pinpointhq.com', 'comeet.co'
];

const FREE_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'proton.me',
  'protonmail.com', 'live.com', 'msn.com', 'me.com', 'mail.com', 'gmx.com'
]);

const GENERIC_NAMES = new Set([
  'no reply', 'noreply', 'no-reply', 'do not reply', 'donotreply', 'greenhouse', 'lever', 'workday',
  'ashby', 'icims', 'smartrecruiters', 'jobvite', 'workable', 'notifications', 'notification', 'recruiting',
  'careers', 'jobs', 'hr', 'talent', 'hiring', 'team', 'admin', 'support', 'info', 'mailer', 'system',
  'applicant tracking system', 'ats'
]);

const TITLE_WORDS = /\b(engineer|developer|manager|analyst|specialist|administrator|architect|designer|director|consultant|lead|technician|coordinator|representative|scientist|associate|officer|programmer|tester|intern|executive|advisor|agent|owner|head)\b/i;

function domainOf(address) {
  return String(address || '').toLowerCase().split('@')[1] || '';
}

function isAtsDomain(domain) {
  return ATS_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// Employer's own mail domain with the shared-ATS and free-mail domains removed,
// reduced to the registrable part ("jobs.acme.com" -> "acme.com").
function employerDomain(address) {
  const d = domainOf(address);
  if (!d || isAtsDomain(d) || FREE_MAIL.has(d)) return null;
  const parts = d.split('.');
  if (parts.length <= 2) return d;
  const twoPartTld = /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoPartTld ? -3 : -2).join('.');
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function clean(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:|,.]+|[\s\-:|,.!]+$/g, '')
    .trim();
}

const COMPANY_SUFFIX_NOISE = /\s+(careers|recruiting|recruitment|recruiter|talent( acquisition| team)?|hiring( team)?|jobs|hr|human resources|people( team| ops)?|notifications?|no[- ]?reply|team)$/i;

function companyFromDisplayName(name) {
  let n = clean(String(name || '').replace(/["<>@]/g, ''));
  for (let i = 0; i < 3; i += 1) n = n.replace(COMPANY_SUFFIX_NOISE, '').trim();
  n = n.replace(/\s+via\s+.+$/i, '').trim();
  if (!n || GENERIC_NAMES.has(n.toLowerCase())) return null;
  if (/@/.test(n) || n.length > 60) return null;
  return n;
}

function companyFromDomain(address) {
  const d = employerDomain(address);
  if (!d) return null;
  const label = d.split('.')[0];
  if (!label || label.length < 2) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// A capitalized company name: words may contain inner dots ("Acme.io") but a
// dot followed by a space ends the name, so it never runs into the next sentence.
const WORD = "[A-Z][\\w&'’\\-]*(?:\\.[\\w&'’\\-]+)*";
const NAME = `(${WORD}(?:,?\\s+(?:${WORD}|of|and|&))*)`;

// A job title: up to five capitalized words ending in a title word ("Senior
// Support Engineer II"). Title words are matched with a capital or lowercase
// first letter only, because JS regexes have no inline case switch.
const TITLE_ALT = TITLE_WORDS.source.replace(/^\\b\(|\)\\b$/g, '').split('|')
  .map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|');
const ROLE = `((?:[A-Z][\\w/.&+#'’\\-]*\\s+){0,5}(?:${TITLE_ALT})(?:\\s+(?:I{1,3}|IV|V|[0-9]+))?)`;

function trimCompany(c) {
  let s = clean(c);
  s = s.replace(/\s+(for|as|and we|where|team|thank|on|about|regarding|to)\b.*$/i, '').trim();
  s = s.replace(/[.!,;:]+$/, '').trim();
  if (!s || s.length > 60 || GENERIC_NAMES.has(s.toLowerCase())) return null;
  if (/^(your|the|this|our|us|we|you|a|an)$/i.test(s)) return null;
  return s;
}

// --- Kind detection -------------------------------------------------------

const RE = {
  receivedSubject: /(thank(s| you)( so much)? for (applying|your (application|interest))|(we('| ha)ve |we )?received your (job )?application|application (received|confirmation|submitted|complete)|your application (has been|was) (received|submitted)|(successfully )?(applied|submitted)|(your )?application (was |has been )?sent|thanks for applying|we got your application)/i,
  receivedBody: /(thank(s| you)( so much)? for (applying|your (application|interest))|(we('| ha)ve |we )?received your (job )?application|your application (has been|was) (successfully )?(received|submitted))/i,
  rejection: /(not (be )?(moving|proceeding) forward|(we |have )?(decided|chosen) to (move forward|proceed|pursue|go|continue) with (other|another|different)|pursue other candidates|other candidates (whose|who|that)|(role|position|job|opening)[^.\n]{0,60}(has been|was|is now) (filled|closed|cancelled|canceled)|no longer (being )?considered|will not be (moving|proceeding|advancing|considering)|regret to (inform|tell|let)|unfortunately,?\s+(we|after|at this|your)[^.\n]{0,120}(\bnot (be )?(moving|proceeding|selected|advancing|able to (offer|move|proceed|advance|extend|consider))|\bnot (a )?(match|fit)|other candidates|\bfilled\b|pursue|decided|no longer|will not|won't)|decided not to (move|proceed|advance)|not selected|not been selected|unable to (offer|move|proceed|advance))/i,
  offer: /((pleased|excited|happy|delighted|thrilled) to (offer|extend)|offer (of employment|letter)|extend (you )?(a|an|the) (formal )?(job )?offer|formal offer|your offer)/i,
  interview: /((schedule|set up|arrange|book|plan)[^.\n]{0,60}(interview|phone screen|screening call|call with|chat with|conversation|meeting)|invite you (to|for) (an? )?(interview|phone screen|screening|call|conversation|chat)|(like|love|want) to (interview|speak with|talk (with|to)|chat with|meet with|connect with) you|interview (invitation|request|invite)|(your |an? )(first|second|final|next)[- ]round|phone screen|video interview|on-?site interview|next steps?[^.\n]{0,40}(interview|call|chat|conversation)|(share|send|let us know)[^.\n]{0,30}availability)/i,
  assessment: /((invit\w+|asked|ask|request\w*|please)[^.\n]{0,80}(complete|take|finish)[^.\n]{0,60}(assessment|coding (challenge|test|exercise)|take-?home|skills? (test|assessment|evaluation)|technical (test|screen|assessment))|(online|coding|technical|skills?|take-?home|pre-?employment|hackerrank|codesignal|codility|coderbyte|testgorilla|hirevue|criteria)\s+(assessment|challenge|test|exercise|interview))/i,
  // "if you are selected we will contact you to schedule an interview" style
  conditional: /\b(if|should|when|once)\b[^.\n]{0,120}\b(selected|qualified|match(es)?|chosen|interested|move forward|proceed|appropriate|a good fit|fit)\b/i
};

// An interview/assessment phrase that sits inside a conditional sentence
// ("if your qualifications match, we will contact you to schedule an
// interview") belongs to a confirmation, not an invitation.
function hasUnconditional(re, text) {
  const sentences = String(text).split(/(?<=[.!?])\s+|\n+/);
  return sentences.some((s) => re.test(s) && !RE.conditional.test(s));
}

function detectKind(subject, body) {
  const subj = String(subject || '');
  const text = `${subj}\n${body}`;

  if (RE.offer.test(subj) || hasUnconditional(RE.offer, body)) {
    // "Offer" must not be a marketing/benefits mention: require job context.
    if (/\b(offer|position|role|job|compensation|salary|start date|employment)\b/i.test(text)) return 'offer';
  }
  if (RE.rejection.test(subj) || hasUnconditional(RE.rejection, body)) return 'rejection';
  if (RE.interview.test(subj) || hasUnconditional(RE.interview, body)) return 'interview_request';
  if (RE.assessment.test(subj) || hasUnconditional(RE.assessment, body)) return 'assessment_request';
  if (RE.receivedSubject.test(subj) || RE.receivedBody.test(body)) return 'application_received';
  return null;
}

// --- Company and role extraction ------------------------------------------

function roleLooksLikeTitle(s) {
  return TITLE_WORDS.test(s) && s.length <= 90;
}

function extractRoleAndCompany(subject, body, fromName, fromAddress) {
  const subj = clean(subject).replace(/^((re|fw|fwd):\s*)+/i, '');
  const sources = [subj, String(body || '').slice(0, 1500)];
  let role = null;
  let company = null;

  const roleAt = new RegExp(`${ROLE}\\s+(?:position\\s+|role\\s+|opening\\s+)?(?:at|with)\\s+${NAME}`);
  const roleOnly = [
    new RegExp(`(?:the\\s+)?${ROLE}\\s+(?:position|role|opening)\\b`),
    new RegExp(`(?:for|to|about|regarding)\\s+(?:the\\s+)?${ROLE}`),
    new RegExp(`(?:position|role|job title|opening)\\s*(?:of|:|-)\\s*${ROLE}`)
  ];
  const companyOnly = new RegExp(`(?:applying to|application to|applied to|sent to|submitted to|interest in(?: joining)?|joining|apply(?:ing)? with|opportunity (?:at|with)|your application (?:at|with)|position at|role at|team at|jobs? at|careers? at)\\s+${NAME}`);

  for (const src of sources) {
    if (role && company) break;
    let m = src.match(roleAt);
    if (m) {
      role = role || clean(m[1]);
      company = company || trimCompany(m[2]);
    }
    if (!role) {
      for (const re of roleOnly) {
        m = src.match(re);
        if (m) { role = clean(m[1]); break; }
      }
    }
    if (!company) {
      m = src.match(companyOnly);
      if (m) {
        const c = trimCompany(m[1]);
        if (c && !roleLooksLikeTitle(c)) company = c;
      }
    }
  }

  // Fallbacks, most reliable first: a display name carrying "Careers"/"Recruiting"
  // is the company by construction; shared-ATS mail names the company in the
  // display name; otherwise the employer's own domain.
  if (!company && /\b(careers|recruiting|recruitment|talent|hiring|jobs|hr)\b/i.test(String(fromName || ''))) {
    company = companyFromDisplayName(fromName);
  }
  if (!company && isAtsDomain(domainOf(fromAddress))) company = companyFromDisplayName(fromName);
  if (!company) company = companyFromDomain(fromAddress);
  if (!company) company = companyFromDisplayName(fromName);
  if (role && company && norm(role) === norm(company)) company = companyFromDisplayName(fromName) || companyFromDomain(fromAddress);
  return { role: role || null, company: company || null };
}

// --- Interview date ----------------------------------------------------------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_PATTERNS = [
  new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, 'gi'),   // October 22, 2026 / Oct 22
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+(20\\d{2}))?\\b`, 'gi'),      // 22 October 2026
  /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g                                                          // 10/22/2026 (US order)
];

// Returns 'YYYY-MM-DD' when the text names exactly ONE calendar date, else
// null (several proposed dates or none: asking the member beats guessing).
// A date with no year takes the year of `received`, or the next year when that
// would put it well in the past.
function parseInterviewDate(text, received) {
  const base = received ? new Date(received) : new Date();
  const found = new Set();
  const add = (y, mo, d) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return;
    let year = y;
    if (!year) {
      year = base.getUTCFullYear();
      if (Date.UTC(year, mo, d, 12) < base.getTime() - 30 * 86400000) year += 1;
    }
    const dt = new Date(Date.UTC(year, mo, d, 12));
    if (dt.getUTCMonth() !== mo) return;            // e.g. Feb 31
    if (!y && dt.getTime() > base.getTime() + 200 * 86400000) return;   // a yearless date far ahead is more likely a past one
    if (dt.getTime() < base.getTime() - 2 * 86400000) return;   // an old date is not an appointment
    found.add(dt.toISOString().slice(0, 10));
  };
  const s = String(text || '').slice(0, 6000);
  let m;
  DATE_PATTERNS[0].lastIndex = 0;
  while ((m = DATE_PATTERNS[0].exec(s))) add(m[3] ? Number(m[3]) : 0, MONTHS[m[1].toLowerCase().slice(0, 4) === 'sept' ? 'sept' : m[1].toLowerCase().slice(0, 3)], Number(m[2]));
  DATE_PATTERNS[1].lastIndex = 0;
  while ((m = DATE_PATTERNS[1].exec(s))) add(m[3] ? Number(m[3]) : 0, MONTHS[m[2].toLowerCase().slice(0, 4) === 'sept' ? 'sept' : m[2].toLowerCase().slice(0, 3)], Number(m[1]));
  DATE_PATTERNS[2].lastIndex = 0;
  while ((m = DATE_PATTERNS[2].exec(s))) add(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return found.size === 1 ? [...found][0] : null;
}

// --- Public: parse one message --------------------------------------------

function parseMail({ fromAddress, fromName, subject, textBody }) {
  const body = String(textBody || '').slice(0, 6000);
  const kind = detectKind(subject, body);
  if (!kind) return null;

  const domain = domainOf(fromAddress);
  const ats = isAtsDomain(domain);
  const { role, company } = extractRoleAndCompany(subject, body, fromName, fromAddress);
  if (!company && !role) return null;
  return {
    kind,
    company: company || null,
    role: role || null,
    ats,
    employerDomain: employerDomain(fromAddress),
    status: STATUS_FOR_KIND[kind],
    confidence: company && role ? 'high' : 'medium'
  };
}

// --- Public: which tracker entry is this mail about? -----------------------

// applications: [{ _id, company, roleTitle, senderDomain, messageIds: [] }].
// Returns the single best entry or null. Ties between different entries return
// null: asking the member beats guessing.
function matchApplication(mail, applications) {
  const refs = `${mail.referencesHeader || ''} ${mail.inReplyToHeader || ''}`;
  const text = norm(`${mail.subject || ''} ${String(mail.textBody || '').slice(0, 3000)} ${mail.fromName || ''}`);
  const domain = employerDomain(mail.fromAddress);

  const scored = [];
  for (const app of applications || []) {
    let score = 0;
    if ((app.messageIds || []).some((id) => id && refs.includes(id))) score = 100;

    const companyN = norm(app.company);
    const roleN = norm(app.roleTitle);
    const companyIn = companyN.length >= 3 && ` ${text} `.includes(` ${companyN} `);
    const roleIn = roleN.length >= 3 && ` ${text} `.includes(` ${roleN} `);
    const sameDomain = Boolean(domain && app.senderDomain && domain === app.senderDomain);

    if (score < 100) {
      if (sameDomain && roleIn) score = 85;
      else if (companyIn && roleIn) score = 80;
      else if (sameDomain) score = 60;
      else if (companyIn) score = 50;
    }
    if (score > 0) scored.push({ app, score });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].app;
}

module.exports = {
  parseInterviewDate,
  parseMail, matchApplication, employerDomain, isAtsDomain, norm,
  STATUS_FOR_KIND, ATS_DOMAINS
};
