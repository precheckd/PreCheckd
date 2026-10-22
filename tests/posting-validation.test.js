// Run: node tests/posting-validation.test.js
const assert = require('assert');
const { validatePosting, parseMoney, parseYmd, endOfDayNewYork, seniorityLabel } = require('../src/services/postingValidation');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

const NOW = new Date('2026-10-22T16:00:00Z').getTime(); // Oct 22 noon in New York
const skillLabels = new Map([['linux', 'Linux'], ['agile', 'Agile'], ['cloud', 'Cloud'], ['security', 'Security'], ['networking', 'Networking']]);
const ctx = { now: NOW, skillLabels };

const good = (over = {}) => ({
  skills: [{ key: 'linux', minLevel: 'Intermediate' }, { key: 'cloud', minLevel: 'Foundational' }],
  titleId: 'cloud-engineer', nickname: 'Acme cloud', hiringCompany: 'Acme Corp', authorizedToRecruit: 'on',
  employmentType: 'full_time', openings: '2',
  arrangement: 'onsite', address: '1 Main St, Boston, MA', relocation: 'no', travel: 'occasional', shift: 'daytime',
  basePayType: 'salary', baseMin: '100000', baseMax: '120000', payBasis: ['skill_level', 'location'],
  benefits: ['health', '401k'], goodFaith: 'on',
  education: 'bachelor', certGroups: [['comptia-security-plus', 'isc2-cissp']], clearance: 'secret',
  closeDate: '2026-11-15', startDate: '2026-12-07', startFirm: 'on', requirementsAttested: 'on', outcomeAck: 'on',
  summary: 'Run and improve our cloud platform with a small, friendly team that ships every week.',
  responsibilities: 'Operate cloud infrastructure\nImprove deploy pipelines\nRespond to incidents',
  team: 'Reports to the head of platform', growth: 'Path to lead engineer',
  ...over,
});
const run = (over, c = ctx) => validatePosting(good(over), c);
const only = (over, field) => {
  const { errors } = run(over);
  assert.ok(errors[field], `expected an error on ${field}, got ${JSON.stringify(errors)}`);
  return errors[field];
};

t('a complete posting passes with no errors', () => {
  const { errors, value } = run({});
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(value.title, 'Cloud Engineer');
  assert.strictEqual(value.seniorityLabel, 'Mid-level');
  assert.strictEqual(value.needsAddress, true);
  assert.strictEqual(value.baseMax, 120000);
  assert.strictEqual(value.certGroups[0].certs[0].label, 'CompTIA Security+');
  assert.strictEqual(value.startDate.toISOString(), '2026-12-07T00:00:00.000Z');
  assert.strictEqual(value.relocation, false);
});

// skills and titles
t('skills: at least one, at most three, no repeats, known keys, valid levels', () => {
  only({ skills: [] }, 'skills');
  only({ skills: [{ key: 'linux' }, { key: 'agile' }, { key: 'cloud' }, { key: 'security' }] }, 'skills');
  only({ skills: [{ key: 'linux' }, { key: 'linux' }] }, 'skills');
  only({ skills: [{ key: 'basketweaving' }] }, 'skills');
  only({ skills: [{ key: 'linux', minLevel: 'Wizard' }] }, 'skills');
});
t('skills may arrive as an object keyed by index (how forms are parsed)', () => {
  const { errors } = run({ skills: { 0: { key: 'linux', minLevel: 'Intermediate' }, 1: { key: 'cloud', minLevel: '' } } });
  assert.deepStrictEqual(errors, {});
});
t('title must fit every picked skill', () => {
  only({ titleId: '' }, 'titleId');
  only({ titleId: 'scrum-master' }, 'titleId');
  only({ titleId: 'made-up-title' }, 'titleId');
});
t('seniority comes from the highest minimum level', () => {
  assert.strictEqual(seniorityLabel([{ minLevel: null }]), 'Entry level');
  assert.strictEqual(seniorityLabel([{ minLevel: 'Foundational' }]), 'Junior');
  assert.strictEqual(seniorityLabel([{ minLevel: 'Advanced' }, { minLevel: 'Foundational' }]), 'Senior');
  assert.strictEqual(seniorityLabel([{ minLevel: 'Expert' }]), 'Lead / Principal');
  const { value } = run({ skills: [{ key: 'linux', minLevel: '' }, { key: 'cloud', minLevel: '' }] });
  assert.strictEqual(value.seniorityLabel, 'Entry level');
});

// company
t('company: required, real, authorization ticked', () => {
  only({ hiringCompany: '' }, 'hiringCompany');
  only({ hiringCompany: 'Confidential Client' }, 'hiringCompany');
  only({ hiringCompany: 'Undisclosed' }, 'hiringCompany');
  only({ hiringCompany: 'client' }, 'hiringCompany');
  only({ authorizedToRecruit: undefined }, 'authorizedToRecruit');
  assert.deepStrictEqual(run({ hiringCompany: 'Booking.com' }).errors, {}); // a real name with a dot is fine
});

// employment
t('employment type, contract length, openings', () => {
  only({ employmentType: 'gig' }, 'employmentType');
  only({ employmentType: 'contract', contractLength: '' }, 'contractLength');
  assert.deepStrictEqual(run({ employmentType: 'contract', contractLength: '6 months' }).errors, {});
  assert.strictEqual(run({ contractLength: '6 months' }).value.contractLength, ''); // ignored unless a contract
  only({ openings: '0' }, 'openings');
  only({ openings: '2.5' }, 'openings');
  only({ openings: '' }, 'openings');
});

// location
t('on-site and hybrid need an address; hybrid needs in-office days', () => {
  only({ address: '' }, 'address');
  only({ arrangement: 'hybrid', inOfficeDays: '' }, 'inOfficeDays');
  only({ arrangement: 'hybrid', inOfficeDays: '5' }, 'inOfficeDays');
  assert.deepStrictEqual(run({ arrangement: 'hybrid', inOfficeDays: '3' }).errors, {});
});
t('remote needs no address and drops any typed', () => {
  const { errors, value } = run({ arrangement: 'remote', address: '12 Secret Rd' });
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(value.address, '');
  assert.strictEqual(value.needsAddress, false);
});
t('remote in area: states or radius, chosen by reason', () => {
  only({ arrangement: 'remote_in_area', areaReason: '' }, 'areaReason');
  only({ arrangement: 'remote_in_area', areaReason: 'states', states: [] }, 'states');
  only({ arrangement: 'remote_in_area', areaReason: 'states', states: ['ZZ'] }, 'states');
  const s = run({ arrangement: 'remote_in_area', areaReason: 'states', states: ['ny', 'NJ', 'NY'] });
  assert.deepStrictEqual(s.errors, {});
  assert.deepStrictEqual(s.value.states, ['NY', 'NJ']);
  assert.strictEqual(s.value.needsAddress, false);
  only({ arrangement: 'remote_in_area', areaReason: 'radius', address: '', radiusMiles: '50' }, 'address');
  only({ arrangement: 'remote_in_area', areaReason: 'radius', radiusMiles: '2' }, 'radiusMiles');
  const r = run({ arrangement: 'remote_in_area', areaReason: 'radius', radiusMiles: '50' });
  assert.deepStrictEqual(r.errors, {});
  assert.strictEqual(r.value.radiusMiles, 50);
  assert.strictEqual(r.value.needsAddress, true);
});
t('relocation, travel and shift are required fixed choices', () => {
  only({ relocation: '' }, 'relocation');
  only({ travel: 'lots' }, 'travel');
  only({ shift: 'whenever' }, 'shift');
});

// pay
t('base pay range: required, ordered, at most 25% wide', () => {
  only({ baseMin: '', baseMax: '' }, 'baseRange');
  only({ baseMin: '120000', baseMax: '100000' }, 'baseRange');
  only({ baseMin: '100000', baseMax: '125001' }, 'baseRange');
  assert.deepStrictEqual(run({ baseMin: '100000', baseMax: '125000' }).errors, {});
  assert.deepStrictEqual(run({ baseMin: '$100,000', baseMax: '$110,000.50' }).errors, {});
  only({ baseMin: '5000', baseMax: '5500' }, 'baseRange'); // too low for a yearly salary
  assert.deepStrictEqual(run({ basePayType: 'hourly', baseMin: '30', baseMax: '37.5' }).errors, {});
  only({ basePayType: 'hourly', baseMin: '30', baseMax: '40' }, 'baseRange');
});
t('commission only forces base pay to 0 and requires commission', () => {
  const bad = run({ commissionOnly: 'on', baseMin: '90000', baseMax: '100000' });
  assert.strictEqual(bad.value.baseMin, 0);
  assert.strictEqual(bad.value.baseMax, 0);
  assert.ok(bad.errors.commission);
  const ok = run({ commissionOnly: 'on', commissionMin: '20000', commissionAverage: '60000', commissionAck: 'on' });
  assert.deepStrictEqual(ok.errors, {});
  assert.strictEqual(ok.value.commission.average, 60000);
});
t('commission only does not need a pay type (the form disables the base fields)', () => {
  const { errors, value } = run({ commissionOnly: 'on', basePayType: undefined, baseMin: undefined, baseMax: undefined, commissionMin: '20000', commissionAverage: '60000', commissionAck: 'on' });
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(value.baseMax, 0);
});
t('commission: two numbers, average not below minimum, warning accepted every time', () => {
  only({ commissionEnabled: 'on', commissionMin: '', commissionAverage: '' , commissionAck: 'on' }, 'commission');
  only({ commissionEnabled: 'on', commissionMin: '50000', commissionAverage: '40000', commissionAck: 'on' }, 'commission');
  only({ commissionEnabled: 'on', commissionMin: '20000', commissionAverage: '40000' }, 'commissionAck');
  const ok = run({ commissionEnabled: 'on', commissionMin: '20000', commissionAverage: '500000', commissionAck: 'on' });
  assert.deepStrictEqual(ok.errors, {}); // no cap on the average; the warning is the guard
  assert.ok(ok.value.commissionAckAt instanceof Date);
  assert.strictEqual(run({}).value.commissionAckAt, null);
});
t('pay basis, benefits and the good-faith box are required', () => {
  only({ payBasis: [] }, 'payBasis');
  only({ payBasis: ['years_of_experience'] }, 'payBasis');
  only({ benefits: [] }, 'benefits');
  assert.deepStrictEqual(run({ benefits: [], noBenefits: 'on' }).errors, {});
  only({ benefits: ['health'], noBenefits: 'on' }, 'benefits');
  assert.deepStrictEqual(run({ benefits: [], benefitsOther: 'Free lunch Fridays' }).errors, {});
  only({ goodFaith: undefined }, 'goodFaith');
});
t('bonus, equity and tips are checkmarks with an optional short note', () => {
  const { value, errors } = run({ bonusOffered: 'on', bonusNote: '10% of salary', equityOffered: 'on', tipsNote: 'ignored without the box' });
  assert.deepStrictEqual(errors, {});
  assert.deepStrictEqual(value.bonus, { offered: true, note: '10% of salary' });
  assert.deepStrictEqual(value.equity, { offered: true, note: '' });
  assert.deepStrictEqual(value.tips, { offered: false, note: '' });
});

// requirements
t('education, certification groups and clearance come from fixed lists', () => {
  only({ education: 'wizard' }, 'education');
  assert.strictEqual(run({ education: '' }).value.education, null);
  only({ clearance: 'cosmic' }, 'clearance');
  assert.strictEqual(run({ clearance: '' }).value.clearance, null);
  only({ certGroups: [['not-a-cert']] }, 'certGroups');
  only({ certGroups: [['comptia-security-plus'], ['isc2-cissp'], ['aws-cloud-practitioner'], ['pmi-pmp']] }, 'certGroups');
  only({ certGroups: [['comptia-security-plus', 'isc2-cissp', 'isc2-ccsp', 'isaca-cism', 'isaca-cisa', 'comptia-a-plus']] }, 'certGroups');
  assert.deepStrictEqual(run({ certGroups: [] }).errors, {});
  assert.deepStrictEqual(run({ certGroups: { 0: ['comptia-security-plus'], 1: ['isc2-cissp'] } }).errors, {});
});
t('the attestation that requirements are genuine and lawful is required', () => {
  only({ requirementsAttested: undefined }, 'requirementsAttested');
});

t('the acknowledgment that an outcome must be recorded is required', () => {
  only({ outcomeAck: undefined }, 'outcomeAck');
});

// dates
t('dates: helpers', () => {
  assert.strictEqual(parseYmd('2026-02-31'), null);
  assert.strictEqual(parseYmd('11/15/2026'), null);
  assert.ok(parseYmd('2026-11-15'));
  // Nov 15 2026 is after the clocks go back: 23:59:59 EST = 04:59:59Z next day. Oct 30 is still EDT.
  assert.strictEqual(endOfDayNewYork(parseYmd('2026-11-15')).toISOString(), '2026-11-16T04:59:59.000Z');
  assert.strictEqual(endOfDayNewYork(parseYmd('2026-10-30')).toISOString(), '2026-10-31T03:59:59.000Z');
  assert.strictEqual(parseMoney('$1,234.50'), 1234.5);
  assert.ok(Number.isNaN(parseMoney('12k')));
});
t('dates: close date must be 1 to 45 days out; start not before close', () => {
  only({ closeDate: '' }, 'closeDate');
  only({ closeDate: '2026-10-22' }, 'closeDate'); // today
  only({ closeDate: '2026-10-01' }, 'closeDate');
  only({ closeDate: '2026-12-07', startDate: '2026-12-20' }, 'closeDate'); // 46 days
  assert.deepStrictEqual(run({ closeDate: '2026-12-06', startDate: '2026-12-20' }).errors, {}); // 45 days
  only({ closeDate: '2026-11-15', startDate: '2026-11-10' }, 'startDate');
  only({ startDate: '' }, 'startDate');
  only({ startDate: '2028-01-01' }, 'startDate');
  assert.strictEqual(run({ startFirm: undefined }).value.startFirm, false);
});

// description and scan
t('description: summary length, 3 to 8 responsibilities, bullets stripped', () => {
  only({ summary: 'Too short.' }, 'summary');
  only({ summary: 'x'.repeat(1001) }, 'summary');
  only({ responsibilities: 'One\nTwo' }, 'responsibilities');
  only({ responsibilities: Array.from({ length: 9 }, (_, i) => `Responsibility number ${i + 1}`).join('\n') }, 'responsibilities');
  const { value } = run({ responsibilities: '- Operate cloud infrastructure\n* Improve deploy pipelines\n1. Respond to incidents\n\n' });
  assert.deepStrictEqual(value.responsibilities, ['Operate cloud infrastructure', 'Improve deploy pipelines', 'Respond to incidents']);
});
t('the free-text scan blocks contact details, years, citizens only and age wording in every text field', () => {
  assert.match(only({ summary: 'Email jobs@acme.com to apply. ' + 'x'.repeat(60) }, 'summary'), /Email addresses/);
  assert.match(only({ responsibilities: 'Run servers\nCall 555-123-4567 today\nShip fast' }, 'responsibilities'), /Phone numbers/);
  assert.match(only({ team: '5+ years of experience with Linux' }, 'team'), /Years of experience/);
  assert.match(only({ growth: 'US citizens only' }, 'growth'), /authorized to work/);
  assert.match(only({ summary: 'A young, digital native team that ' + 'x'.repeat(60) }, 'summary'), /age, gender or nationality/);
  assert.match(only({ bonusOffered: 'on', bonusNote: 'text me on whatsapp' }, 'bonus'), /contact you elsewhere/);
  only({ benefits: [], benefitsOther: 'see www.perks.com' }, 'benefits');
  only({ employmentType: 'contract', contractLength: 'call 555-123-4567' }, 'contractLength');
});

t('several mistakes are all reported at once', () => {
  const { errors } = validatePosting({}, ctx);
  for (const f of ['skills', 'titleId', 'hiringCompany', 'authorizedToRecruit', 'employmentType', 'openings', 'arrangement', 'relocation',
    'travel', 'shift', 'basePayType', 'baseRange', 'payBasis', 'benefits', 'goodFaith', 'closeDate', 'startDate', 'requirementsAttested', 'outcomeAck', 'summary', 'responsibilities']) {
    assert.ok(errors[f], 'no error for ' + f);
  }
});

console.log(`\n${n} tests passed`);
