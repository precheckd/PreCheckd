// The free-text scan for job postings (Kent's rules). Every free-text field on a posting goes through
// scanText(); anything it finds blocks the posting, with the reason shown so the recruiter can fix it.
//
//   - contact details (phone, email, links, "message me on WhatsApp/Telegram"): applying happens only
//     through PreCheckd, so contact details in an ad are a way around it
//   - "X+ years of experience": years of experience is not a requirement on PreCheckd (skills are)
//   - "US citizens only": the lawful wording is "authorized to work in the US" (clearance has its own field)
//   - wording that signals age, gender or nationality preferences
//
// scanText returns [{ code, match, message }], empty when the text is clean.

const RULES = [
  {
    code: 'email',
    test: (t) => firstMatch(t, /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/i)
      || firstMatch(t, /\b[\w.-]+\s*(?:\[at\]|\(at\)|\{at\})\s*[\w-]+\s*(?:\[dot\]|\(dot\)|\{dot\})\s*\w+/i),
    message: 'Email addresses are not allowed. Candidates apply through PreCheckd only.',
  },
  {
    code: 'phone',
    // 10 digits written the usual ways: 555-123-4567, (555) 123 4567, +1 555.123.4567, 5551234567
    test: (t) => firstMatch(t, /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/),
    message: 'Phone numbers are not allowed. Candidates apply through PreCheckd only.',
  },
  {
    code: 'link',
    // .NET is a skill, so ".net" is left out of the domain endings on purpose.
    test: (t) => firstMatch(t, /\bhttps?:\/\/\S+/i)
      || firstMatch(t, /\bwww\.\S+/i)
      || firstMatch(t, /\b[a-z0-9-]+\.(?:com|org|io|co|us|ai|me|ly|gl|app|dev|biz|info)\b(?:\/\S*)?/i),
    message: 'Links are not allowed. The posting already shows the company, and candidates apply through PreCheckd only.',
  },
  {
    code: 'off_platform',
    test: (t) => firstMatch(t, /\b(?:whats\s?app|telegram|wechat|text\s+me|dm\s+me|call\s+me|email\s+me|reach\s+me\s+at)\b/i),
    message: 'Asking candidates to contact you elsewhere is not allowed. Candidates apply through PreCheckd only.',
  },
  {
    code: 'citizens_only',
    test: (t) => firstMatch(t, /\b(?:u\.?s\.?|american)?\s*citizens?\s+only\b/i)
      || firstMatch(t, /\bmust\s+be\s+(?:a\s+)?(?:u\.?s\.?|american)\s+citizen\b/i)
      || firstMatch(t, /\b(?:u\.?s\.?\s+)?citizenship\s+(?:is\s+)?required\b/i),
    message: 'Do not limit a job to citizens in the text. Candidates must be authorized to work in the US, and a clearance requirement has its own field.',
  },
  {
    code: 'age_gender_nationality',
    test: (t) => firstMatch(t, /\b(?:young|youthful|digital\s+natives?|recent\s+grad(?:uate)?s?|new\s+grads?|native\s+(?:english\s+)?speakers?|native[-\s]level\s+english|he\s*\/\s*she|s\s*\/\s*he|he\s+or\s+she|his\s*\/\s*her)\b/i),
    message: 'This wording can signal an age, gender or nationality preference. Describe the skills the job needs instead.',
  },
];

function firstMatch(text, re) {
  const m = re.exec(text);
  return m ? m[0].trim() : null;
}

// "5+ years", "3-5 years", "five years", "10 yrs" anywhere in a sentence that is about experience.
const YEARS = /\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|-\s*\d{1,2}|to\s+\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/i;
const EXPERIENCE_WORDS = /\b(?:experience|exp|expertise|background|hands[-\s]on|working|industry|in\s+the\s+field|professional)\b/i;

function yearsOfExperience(text) {
  for (const sentence of String(text).split(/[.!?\n;]+/)) {
    const m = YEARS.exec(sentence);
    if (m && EXPERIENCE_WORDS.test(sentence)) return m[0].trim();
  }
  return null;
}

function scanText(text) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const found = [];
  for (const rule of RULES) {
    const match = rule.test(t);
    if (match) found.push({ code: rule.code, match, message: rule.message });
  }
  const years = yearsOfExperience(t);
  if (years) {
    found.push({ code: 'years_of_experience', match: years,
      message: 'Years of experience is not a requirement on PreCheckd. Ask for the skills and the skill level the job needs instead.' });
  }
  return found;
}

// fields: { fieldName: text | [text, ...] }. Returns { fieldName: [issue, ...] } for fields with problems.
function scanFields(fields) {
  const out = {};
  for (const [name, value] of Object.entries(fields)) {
    const texts = Array.isArray(value) ? value : [value];
    const issues = [];
    for (const t of texts) for (const issue of scanText(t)) if (!issues.some((i) => i.code === issue.code)) issues.push(issue);
    if (issues.length) out[name] = issues;
  }
  return out;
}

module.exports = { scanText, scanFields };
