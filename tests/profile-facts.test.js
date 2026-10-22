// Run: node tests/profile-facts.test.js
// Covers education levels, the certification catalog, and the adapter that feeds the apply gate.
const assert = require('assert');
const { guessLevel, educationFacts, indexOf, LEVELS } = require('../src/utils/educationLevel');
const { catalogIdFor, CATALOG, byId, search, normalize } = require('../src/content/certCatalog');
const { toFacts, skillFactsFrom, certFacts } = require('../src/services/applyFacts');
const gate = require('../src/services/applyGate');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

const NOW = new Date('2026-10-22T16:00:00Z').getTime();
const DAY = 86400000;

// ---- education ---------------------------------------------------------------------------------
t('level indexes line up with the gate', () => {
  assert.deepStrictEqual(LEVELS.map((l) => l.label), gate.EDUCATION_LEVELS.slice(1));
  assert.strictEqual(indexOf('bachelor'), 3);
  assert.strictEqual(indexOf('nonsense'), 0);
});
t('guessLevel reads common degree wording', () => {
  assert.strictEqual(guessLevel('BS Computer Science'), 'bachelor');
  assert.strictEqual(guessLevel('B.A. History'), 'bachelor');
  assert.strictEqual(guessLevel("Bachelor's of Science"), 'bachelor');
  assert.strictEqual(guessLevel('MBA'), 'master');
  assert.strictEqual(guessLevel('M.S. Cybersecurity'), 'master');
  assert.strictEqual(guessLevel('Associate of Applied Science'), 'associate');
  assert.strictEqual(guessLevel('AAS Networking'), 'associate');
  assert.strictEqual(guessLevel('PhD Physics'), 'doctorate');
  assert.strictEqual(guessLevel('High School Diploma'), 'high_school');
  assert.strictEqual(guessLevel('GED'), 'high_school');
});
t('guessLevel returns null when it cannot tell', () => {
  assert.strictEqual(guessLevel(''), null);
  assert.strictEqual(guessLevel(null), null);
  assert.strictEqual(guessLevel('Computer Science'), null);
});
t('educationFacts: only verified entries count as verified', () => {
  const f = educationFacts([
    { degree: 'BS Computer Science', level: 'bachelor', verified: true },
    { degree: 'MS Cybersecurity', level: 'master', verified: false },
  ]);
  assert.deepStrictEqual(f, { verifiedLevel: 3, pendingLevel: 4 });
});
t('educationFacts: a saved level beats the guess', () => {
  const f = educationFacts([{ degree: 'BS Computer Science', level: 'associate', verified: true }]);
  assert.strictEqual(f.verifiedLevel, 2);
});
t('educationFacts: an entry saved before levels existed falls back to the guess', () => {
  assert.strictEqual(educationFacts([{ degree: 'MBA', verified: true }]).verifiedLevel, 4);
  assert.deepStrictEqual(educationFacts([{ degree: 'Something odd', verified: true }]), { verifiedLevel: 0, pendingLevel: 0 });
  assert.deepStrictEqual(educationFacts(undefined), { verifiedLevel: 0, pendingLevel: 0 });
});

// ---- certification catalog ---------------------------------------------------------------------
t('catalog ids are unique and every name or alias maps to exactly one entry', () => {
  const ids = new Set();
  const seen = new Map();
  for (const c of CATALOG) {
    assert.ok(!ids.has(c.id), 'duplicate id ' + c.id);
    ids.add(c.id);
    for (const label of [c.name, ...c.aliases]) {
      const key = normalize(label);
      if (seen.has(key)) assert.strictEqual(seen.get(key), c.id, `"${label}" is claimed by ${seen.get(key)} and ${c.id}`);
      seen.set(key, c.id);
    }
  }
});
t('names match however they are written', () => {
  assert.strictEqual(catalogIdFor('CompTIA Security+'), 'comptia-security-plus');
  assert.strictEqual(catalogIdFor('security plus'), 'comptia-security-plus');
  assert.strictEqual(catalogIdFor('  COMPTIA   SECURITY+ CE  '), 'comptia-security-plus');
  assert.strictEqual(catalogIdFor('AWS Certified Cloud Practitioner'), 'aws-cloud-practitioner');
  assert.strictEqual(catalogIdFor('SAFe 6 Agilist'), 'scaled-agile-safe-agilist');
  assert.strictEqual(catalogIdFor('Certified Information Systems Security Professional (CISSP)'), 'isc2-cissp');
});
t('A+ and Security+ stay different', () => {
  assert.notStrictEqual(catalogIdFor('A+'), catalogIdFor('Security+'));
  assert.strictEqual(catalogIdFor('Security'), null);
});
t('unknown names do not match', () => {
  assert.strictEqual(catalogIdFor('Certified Bean Counter'), null);
  assert.strictEqual(catalogIdFor(''), null);
  assert.strictEqual(catalogIdFor(null), null);
});
t('search and byId', () => {
  assert.ok(search('sec').some((c) => c.id === 'comptia-security-plus'));
  assert.strictEqual(byId('isc2-cissp').name, 'CISSP');
  assert.strictEqual(byId('nope'), null);
});

// ---- adapter: skills ---------------------------------------------------------------------------
t('skillFactsFrom keeps real levels and finds the 60-day lock', () => {
  const current = [{ key: 'linux', label: 'Linux', level: 'Intermediate', takenAt: new Date(NOW - 10 * DAY) }];
  const rows = [{ skills: [{ key: 'linux', label: 'Linux', score: 70 }], completedAt: new Date(NOW - 10 * DAY), held: false, reviewDecision: null }];
  const [s] = skillFactsFrom(current, rows, NOW);
  assert.strictEqual(s.level, 'Intermediate');
  assert.strictEqual(s.nextAttemptAt.getTime(), NOW + 50 * DAY);
  assert.strictEqual(s.reviewing, false);
});
t('skillFactsFrom: a lock that has passed is dropped', () => {
  const current = [{ key: 'linux', label: 'Linux', level: 'Intermediate', takenAt: new Date(NOW - 100 * DAY) }];
  const rows = [{ skills: [{ key: 'linux', score: 70 }], completedAt: new Date(NOW - 100 * DAY) }];
  assert.strictEqual(skillFactsFrom(current, rows, NOW)[0].nextAttemptAt, null);
});
t('skillFactsFrom: a rejected attempt starts no lock', () => {
  const current = [];
  const rows = [{ skills: [{ key: 'linux', score: 10 }], completedAt: new Date(NOW - 2 * DAY), held: true, reviewDecision: 'rejected' }];
  assert.deepStrictEqual(skillFactsFrom(current, rows, NOW), []);
});
t('skillFactsFrom: an undecided held attempt means "being reviewed"', () => {
  const rows = [{ skills: [{ key: 'linux', label: 'Linux', score: 80 }], completedAt: new Date(NOW - DAY), held: true, reviewDecision: null }];
  const [s] = skillFactsFrom([], rows, NOW);
  assert.strictEqual(s.reviewing, true);
  const posting = { skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }] };
  const r = gate.evaluate({ skills: [s], verified: { email: true, phone: true, identity: true } }, posting, NOW);
  assert.strictEqual(r.blockers[0].code, 'skill_reviewing');
});

// ---- adapter: the rest of the profile ----------------------------------------------------------
const base = () => ({
  emailVerifiedAt: new Date('2026-09-01'), isPhoneVerified: true, isIdentityVerified: true,
  educationHistory: [], certifications: [], securityClearance: 'none', shifts: [], availableFrom: null,
});
t('toFacts: verification flags', () => {
  const f = toFacts({ ...base(), isIdentityVerified: false });
  assert.deepStrictEqual(f.verified, { email: true, phone: true, identity: false });
});
t('toFacts: clearance maps to the gate scale, "other" counts as none', () => {
  assert.strictEqual(toFacts({ ...base(), securityClearance: 'secret' }).clearance, 2);
  assert.strictEqual(toFacts({ ...base(), securityClearance: 'ts_sci' }).clearance, 4);
  assert.strictEqual(toFacts({ ...base(), securityClearance: 'other' }).clearance, 0);
});
t('toFacts: certs keep only catalog matches, with the catalog label', () => {
  const f = toFacts({ ...base(), certifications: [
    { name: 'Security+', verified: true, expiresAt: new Date('2027-01-01') },
    { name: 'Homemade Badge', verified: true },
  ] });
  assert.strictEqual(f.certs.length, 1);
  assert.deepStrictEqual(f.certs[0], { catalogId: 'comptia-security-plus', label: 'CompTIA Security+', verified: true, expiresAt: new Date('2027-01-01') });
  assert.deepStrictEqual(certFacts(undefined), []);
});
t('toFacts: remote jobs skip the area check; others read Work Areas', () => {
  const manhattan = { type: 'MultiPolygon', coordinates: [[[[-74.05, 40.7], [-73.93, 40.7], [-73.93, 40.8], [-74.05, 40.8], [-74.05, 40.7]]]] };
  const cand = { ...base(), workAreas: manhattan };
  assert.strictEqual(toFacts(cand, { posting: { arrangement: 'remote' } }).areaMatch, null);
  assert.strictEqual(toFacts(cand, { posting: { arrangement: 'onsite', areaRule: { point: [-73.99, 40.75] } } }).areaMatch, true);
  assert.strictEqual(toFacts(cand, { posting: { arrangement: 'onsite', areaRule: { point: [-71.06, 42.36] } } }).areaMatch, false);
  assert.strictEqual(toFacts(cand, { posting: { arrangement: 'remote_in_area', areaRule: { states: ['TX'] } } }).areaMatch, false);
  assert.strictEqual(toFacts({ ...base() }, { posting: { arrangement: 'hybrid', areaRule: { point: [-73.99, 40.75] } } }).areaMatch, null);
});

// ---- end to end through the gate ---------------------------------------------------------------
t('a full profile passes a posting that asks for everything', () => {
  const cand = {
    ...base(), securityClearance: 'top_secret', shifts: ['daytime'], availableFrom: new Date('2026-11-01T00:00:00Z'),
    educationHistory: [{ degree: 'BS Computer Science', level: 'bachelor', verified: true }],
    certifications: [{ name: 'CompTIA Security+ ce', verified: true, expiresAt: new Date('2027-06-01T00:00:00Z') }],
    workAreas: { type: 'MultiPolygon', coordinates: [[[[-74.05, 40.7], [-73.93, 40.7], [-73.93, 40.8], [-74.05, 40.8], [-74.05, 40.7]]]] },
  };
  const skills = skillFactsFrom([{ key: 'linux', label: 'Linux', level: 'Advanced', takenAt: new Date(NOW - 30 * DAY) }], [], NOW);
  const posting = {
    status: 'open', closeDate: new Date(NOW + 10 * DAY),
    skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }],
    education: 3, certGroups: [[{ catalogId: 'comptia-security-plus', label: 'CompTIA Security+' }, { catalogId: 'isc2-cissp', label: 'CISSP' }]],
    clearance: 3, shift: 'daytime', arrangement: 'onsite', areaRule: { point: [-73.99, 40.75] },
    startDate: new Date('2026-12-01T00:00:00Z'), startFirm: true,
  };
  const r = gate.evaluate(toFacts(cand, { skills, posting }), posting, NOW);
  assert.deepStrictEqual(r.blockers, []);
  assert.strictEqual(r.canApply, true);
});
t('a thin profile is told every reason at once', () => {
  const posting = {
    status: 'open', closeDate: new Date(NOW + 10 * DAY),
    skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }],
    education: 3, certGroups: [[{ catalogId: 'isc2-cissp', label: 'CISSP' }]], clearance: 2, shift: 'overnight',
    arrangement: 'remote_in_area', areaRule: { states: ['NY'] }, areaLabel: 'NY',
  };
  const r = gate.evaluate(toFacts(base(), { skills: [], posting }), posting, NOW);
  const codes = r.blockers.map((b) => b.code);
  for (const c of ['skill_missing', 'education_missing', 'cert_missing', 'clearance_missing', 'shift_missing', 'area_unset']) {
    assert.ok(codes.includes(c), c + ' missing from ' + codes);
  }
  assert.strictEqual(r.canApply, false);
});

console.log(`\n${n} tests passed`);
