// Pay suggestions shown on the job form. Source: U.S. Bureau of Labor Statistics, Occupational Employment and
// Wage Statistics (OEWS), national annual wages, May 2023. Update YEAR and the numbers each spring.
// Each seniority level gets a band between two neighbouring BLS percentiles:
//   Entry level  P10-P25 | Junior P25-P50 | Mid-level P50-P75 | Senior P75-P90 | Lead / Principal P90 and up
// Titles that have no good BLS match are simply left out of TITLE_SOC, and no suggestion is shown for them.

const YEAR = 'May 2023';
const SOURCE = 'U.S. Bureau of Labor Statistics (OEWS national wages, ' + YEAR + ')';

// SOC code -> [P10, P25, P50, P75, P90] annual wages
const SOC = {
  '15-1232': { name: 'Computer User Support Specialists', p: [37690, 46550, 59240, 75950, 97020] },
  '15-1244': { name: 'Network and Computer Systems Administrators', p: [58680, 74400, 95360, 121910, 148710] },
  '15-1252': { name: 'Software Developers', p: [77020, 101200, 132270, 167540, 208620] },
  '15-1212': { name: 'Information Security Analysts', p: [69210, 90050, 120360, 153550, 182370] },
  '15-1241': { name: 'Computer Network Architects', p: [77960, 100120, 129840, 164080, 195000] },
  '15-1242': { name: 'Database Administrators', p: [54320, 71940, 101510, 133120, 157710] },
  '15-1253': { name: 'Software QA Analysts and Testers', p: [58740, 78470, 101800, 130630, 164520] },
  '15-2051': { name: 'Data Scientists', p: [61070, 79810, 108020, 147670, 184090] },
};

// catalog title id -> closest BLS occupation. Support-engineer titles use the systems-admin occupation (closest fit).
const TITLE_SOC = {
  'help-desk-technician': '15-1232', 'it-support-specialist': '15-1232', 'desktop-support-engineer': '15-1232',
  'product-support-engineer': '15-1244', 'technical-support-engineer': '15-1244', 'cloud-support-engineer': '15-1244',
  'systems-administrator': '15-1244', 'linux-administrator': '15-1244', 'windows-administrator': '15-1244',
  'network-administrator': '15-1244', 'security-administrator': '15-1244',
  'network-engineer': '15-1241', 'cloud-architect': '15-1241',
  'cloud-engineer': '15-1252', 'devops-engineer': '15-1252', 'site-reliability-engineer': '15-1252',
  'security-analyst': '15-1212', 'soc-analyst': '15-1212', 'cybersecurity-engineer': '15-1212', 'grc-analyst': '15-1212',
  'penetration-tester': '15-1212', 'incident-responder': '15-1212',
  'software-engineer': '15-1252', 'front-end-developer': '15-1252', 'back-end-developer': '15-1252', 'full-stack-developer': '15-1252',
  'qa-engineer': '15-1253', 'database-administrator': '15-1242', 'data-engineer': '15-2051',
};

const LEVELS = ['Entry level', 'Junior', 'Mid-level', 'Senior', 'Lead / Principal'];
// [lowIndex, highIndex] into the percentile array; null high = open ended ("and up")
const BAND = [[0, 1], [1, 2], [2, 3], [3, 4], [4, null]];

const round = (n) => Math.round(n / 1000) * 1000;

// Suggested annual band for a title and seniority label, or null when there is no good match.
function bandFor(titleId, seniorityLabel) {
  const soc = TITLE_SOC[titleId];
  const li = LEVELS.indexOf(seniorityLabel);
  if (!soc || li < 0) return null;
  const [a, b] = BAND[li];
  const p = SOC[soc].p;
  return { soc, occupation: SOC[soc].name, year: YEAR, low: round(p[a]), high: b === null ? null : round(p[b]) };
}

// 'below' | 'within' | 'above' for a posted annual-equivalent range against a band
function positionOf(band, annualMin, annualMax) {
  if (!band) return null;
  if (annualMax < band.low) return 'below';
  if (band.high !== null && annualMin > band.high) return 'above';
  if (annualMin < band.low) return 'below';
  return 'within';
}

// Everything the browser needs, keyed by title id then level
function clientTable() {
  const out = {};
  for (const id of Object.keys(TITLE_SOC)) {
    out[id] = {};
    for (const l of LEVELS) out[id][l] = bandFor(id, l);
  }
  return { year: YEAR, source: SOURCE, bands: out };
}

module.exports = { YEAR, SOURCE, LEVELS, bandFor, positionOf, clientTable, TITLE_SOC };
