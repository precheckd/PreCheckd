// Mail alias naming and assignment (email foundation, roadmap #4).
//
// Convention, in order, no dashes or spaces:
//   1. firstlast      janesmith
//   2. flast          jsmith
//   3. lastfirst      smithjane
//   4. firstlast + a number (janesmith2, janesmith3, ...)
// Candidates live on in.precheckd.com and recruiters on
// recruiters.precheckd.com, so a name only has to be unique within its own
// namespace. Aliases never change and are never reused (see MailAlias model).
const MailAlias = require('../models/MailAlias');

const DOMAINS = {
  candidate: process.env.MAIL_DOMAIN_CANDIDATE || 'in.precheckd.com',
  recruiter: process.env.MAIL_DOMAIN_RECRUITER || 'recruiters.precheckd.com'
};

// Addresses people expect to be the company's, plus role mailboxes that mail
// systems and abuse reporters assume exist.
const RESERVED = new Set([
  'postmaster', 'abuse', 'admin', 'administrator', 'support', 'help', 'noreply', 'no-reply',
  'donotreply', 'info', 'security', 'billing', 'legal', 'privacy', 'hr', 'careers', 'jobs',
  'hello', 'contact', 'team', 'press', 'sales', 'root', 'webmaster', 'hostmaster', 'mailer-daemon',
  'mailerdaemon', 'bounce', 'bounces', 'unsubscribe', 'verify', 'verification', 'trust', 'safety',
  'precheckd', 'staff', 'system', 'test'
]);

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'phd', 'md', 'esq']);

// Lowercase letters and digits only: strips accents, punctuation, spaces and
// hyphens ("María José O'Neil-Smith" -> "mariajoseoneilsmith").
function cleanPart(str) {
  return String(str || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Drops trailing generational/professional suffixes from a last name
// ("Smith Jr." -> "smith").
function cleanLastName(str) {
  const words = String(str || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[\s,]+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join('');
}

function isUsable(alias) {
  return alias.length >= 3 && alias.length <= 40 && !RESERVED.has(alias);
}

// The ordered list of names to try for a person, tiers 1-3.
function candidateAliases(firstName, lastName) {
  const first = cleanPart(firstName);
  const last = cleanLastName(lastName);
  const list = [];
  if (first && last) {
    list.push(first + last, first[0] + last, last + first);
  } else if (first || last) {
    list.push(first || last);
  }
  return [...new Set(list)].filter(isUsable);
}

// Picks the first free alias. `isTaken(alias)` is async so this works against
// the database or a stub. After tier 3 it appends numbers.
async function pickAlias(firstName, lastName, isTaken) {
  const tiers = candidateAliases(firstName, lastName);
  if (tiers.length === 0) tiers.push('member'); // no usable name on file
  for (const alias of tiers) {
    if (!(await isTaken(alias))) return alias;
  }
  const base = tiers[0] || 'member';
  for (let n = 2; n < 10000; n += 1) {
    const alias = `${base}${n}`;
    if (isUsable(alias) && !(await isTaken(alias))) return alias;
  }
  throw new Error('Could not find a free mail alias');
}

// Returns the owner's alias row, creating it if they don't have one yet.
// Safe to call repeatedly and concurrently: the unique indexes decide races.
async function ensureMailAlias(namespace, owner) {
  const existing = await MailAlias.findOne({ namespace, ownerId: owner._id });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const alias = await pickAlias(
      owner.firstName,
      owner.lastName,
      async (a) => Boolean(await MailAlias.exists({ namespace, alias: a }))
    );
    try {
      return await MailAlias.create({ namespace, alias, ownerId: owner._id });
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Either someone grabbed this alias a moment ago (try the next one) or
      // a parallel call already gave this owner theirs (return it).
      const mine = await MailAlias.findOne({ namespace, ownerId: owner._id });
      if (mine) return mine;
    }
  }
  throw new Error('Could not assign a mail alias');
}

function addressFor(namespace, alias) {
  return `${alias}@${DOMAINS[namespace]}`;
}

// "jane@in.precheckd.com" -> { namespace: 'candidate', alias: 'jane' } or null
// when the domain isn't one of ours.
function parseAddress(address) {
  const m = String(address || '').trim().toLowerCase().match(/<?([^<>\s@]+)@([^<>\s@]+)>?$/);
  if (!m) return null;
  const alias = m[1].split('+')[0];
  const entry = Object.entries(DOMAINS).find(([, domain]) => domain === m[2]);
  return entry ? { namespace: entry[0], alias } : null;
}

module.exports = {
  DOMAINS, RESERVED, cleanPart, cleanLastName, candidateAliases, pickAlias,
  ensureMailAlias, addressFor, parseAddress
};
