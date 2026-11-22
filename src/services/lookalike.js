// Spots domains that imitate a well-known employer, the most common recruiter scam: amaz0n-careers.com,
// microsoft-hiring.net, delloite.com. Pure functions, no network. Signals, not verdicts: the wording on the page
// tells people to check the spelling, never that the sender is a scammer.
const BRANDS = {
  amazon: 'Amazon', microsoft: 'Microsoft', google: 'Google', apple: 'Apple', facebook: 'Facebook', netflix: 'Netflix',
  oracle: 'Oracle', cisco: 'Cisco', salesforce: 'Salesforce', adobe: 'Adobe', deloitte: 'Deloitte', accenture: 'Accenture',
  kpmg: 'KPMG', jpmorgan: 'JPMorgan', bankofamerica: 'Bank of America', wellsfargo: 'Wells Fargo', citibank: 'Citi',
  goldmansachs: 'Goldman Sachs', morganstanley: 'Morgan Stanley', walmart: 'Walmart', costco: 'Costco', homedepot: 'Home Depot',
  lowes: 'Lowe\'s', bestbuy: 'Best Buy', fedex: 'FedEx', boeing: 'Boeing', lockheedmartin: 'Lockheed Martin',
  raytheon: 'Raytheon', northropgrumman: 'Northrop Grumman', generaldynamics: 'General Dynamics', tesla: 'Tesla',
  airbnb: 'Airbnb', paypal: 'PayPal', stripe: 'Stripe', linkedin: 'LinkedIn', indeed: 'Indeed', ziprecruiter: 'ZipRecruiter',
  glassdoor: 'Glassdoor', roberthalf: 'Robert Half', randstad: 'Randstad', adecco: 'Adecco', manpower: 'ManpowerGroup',
  kellyservices: 'Kelly Services', insightglobal: 'Insight Global', teksystems: 'TEKsystems', cognizant: 'Cognizant',
  infosys: 'Infosys', capgemini: 'Capgemini', nvidia: 'NVIDIA', qualcomm: 'Qualcomm', verizon: 'Verizon',
  comcast: 'Comcast', disney: 'Disney', starbucks: 'Starbucks', mcdonalds: 'McDonald\'s', pepsico: 'PepsiCo',
  cocacola: 'Coca-Cola', unitedhealth: 'UnitedHealth', pfizer: 'Pfizer', allstate: 'Allstate', statefarm: 'State Farm',
  geico: 'GEICO', progressive: 'Progressive', proofpoint: 'Proofpoint', crowdstrike: 'CrowdStrike',
  paloaltonetworks: 'Palo Alto Networks', fortinet: 'Fortinet', servicenow: 'ServiceNow', workday: 'Workday',
  snowflake: 'Snowflake', datadog: 'Datadog', atlassian: 'Atlassian', shopify: 'Shopify', dropbox: 'Dropbox',
  spotify: 'Spotify', openai: 'OpenAI', anthropic: 'Anthropic', meta: 'Meta', intel: 'Intel', uber: 'Uber',
  target: 'Target', ibm: 'IBM', dell: 'Dell', nike: 'Nike', cvs: 'CVS',
};

// Extra words scammers bolt onto a real name.
const EXTRAS = new Set([
  'career', 'careers', 'job', 'jobs', 'hiring', 'hire', 'hr', 'recruit', 'recruiting', 'recruiter', 'recruitment',
  'talent', 'staffing', 'apply', 'work', 'team', 'global', 'group', 'usa', 'us', 'inc', 'corp', 'online', 'official',
  'portal', 'human', 'resources', 'employment', 'openings', 'support',
]);

// Real domains that look like a pattern we flag but belong to the company.
const KNOWN_REAL = new Set(['metacareers.com']);

const TWO_PART_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

// The main name part of a domain: "careers.amazon.co.uk" -> "amazon".
function mainLabel(domain) {
  const parts = String(domain).toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  const n = parts.length;
  return (n >= 3 && TWO_PART_SUFFIXES.has(parts[n - 2]) && parts[n - 1].length === 2) ? parts[n - 3] : parts[n - 2];
}

// Undo look-alike characters: amaz0n -> amazon, rnicrosoft -> microsoft.
function normalize(s) {
  return s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/4/g, 'a');
}

// Undo look-alike characters only in words made mostly of letters, so "hr2" style words are left alone.
const normalizeWord = (w) => (/[a-z]/.test(w) ? normalize(w) : w);

// Edit distance where swapping two neighboring letters counts as one change.
function distance(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Returns null, or { kind: 'lookalike' | 'uses_name', brand }.
function check(domain) {
  const label = mainLabel(domain);
  if (!label || BRANDS[label.replace(/-/g, '')] || KNOWN_REAL.has(String(domain).toLowerCase())) return null; // exactly a known name: nothing to flag

  // 1. The name plus extra words: amazon-careers, microsoftjobs, hr-deloitte. Look-alike characters are undone first.
  const tokens = label.split('-').filter(Boolean).map(normalizeWord);
  for (const key of Object.keys(BRANDS)) {
    if (tokens.length > 1 && tokens.includes(key) && tokens.every((t) => t === key || EXTRAS.has(t))) return { kind: 'uses_name', brand: BRANDS[key] };
    if (tokens.length === 1) {
      const t = tokens[0];
      const rest = t.startsWith(key) ? t.slice(key.length) : t.endsWith(key) ? t.slice(0, -key.length) : null;
      if (rest && EXTRAS.has(rest)) return { kind: 'uses_name', brand: BRANDS[key] };
    }
  }

  // 2. A near-miss spelling of the name. Short names are skipped: too many ordinary words sit one letter away.
  const flat = label.replace(/-/g, '');
  const fixed = normalize(flat);
  for (const key of Object.keys(BRANDS)) {
    if (key.length < 6) continue;
    if (fixed === key || distance(flat, key) === 1 || (key.length >= 8 && distance(flat, key) === 2)) return { kind: 'lookalike', brand: BRANDS[key] };
  }
  return null;
}

module.exports = { check, mainLabel, distance, normalize };
