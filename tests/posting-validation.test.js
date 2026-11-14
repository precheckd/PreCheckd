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
  titleId: 'devops-aws', title: 'DevOps (AWS)', nickname: 'Acme cloud', hiringCompany: 'Acme Corp', companyWebsite: 'https://www.acme.com/careers?x=1', authorizedToRecruit: 'on',
  employmentType: 'full_time', openings: '2',
  arrangement: 'onsite', address: '1 Main St, Boston, MA', relocation: 'no', travel: 'occasional', shift: 'daytime',
  basePayType: 'salary', baseMin: '100000', baseMax: '120000', payBasis: ['skill_level', 'location'],
  benefits: ['health', '401k'], goodFaith: 'on',
  education: 'bachelor', certGroups: [['comptia-security-plus', 'isc2-cissp']], clearance: 'secret',
  closeDate: '2026-11-15', startDate: '2026-12-07', startFirm: 'on', requirementsAttested: 'on', outcomeAck: 'on',
  summary: 'Run and improve our cloud platform with a small, friendly team that ships every week.',
  responsibilities: 'Operate cloud infrastructure\nImprove deploy pipelines\nRespond to incidents',
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
  assert.strictEqual(value.title, 'DevOps (AWS)');
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
  const { errors } = run({ skills: { 0: { key: 'linux', minLevel: 'Intermediate' }, 1: { key: 'cloud', minLevel: 'none' } } });
  assert.deepStrictEqual(errors, {});
});
t('the title must be one of our roles; a missing or made-up title is refused', () => {
  only({ title: '', titleId: '' }, 'titleId');
  only({ title: 'Infrastructure Engineer', titleId: 'custom' }, 'titleId');
  only({ title: 'Anything', titleId: 'not-a-role' }, 'titleId');
  const byId = validatePosting(good({ title: '', titleId: 'devops-aws' }), ctx);
  assert.ok(!byId.errors.titleId); assert.strictEqual(byId.value.title, 'DevOps (AWS)');
  const typed = validatePosting(good({ titleId: '', title: 'devops (aws)' }), ctx);   // drafts saved before the change
  assert.strictEqual(typed.value.titleId, 'devops-aws');
});
t('a posting saved with its own title keeps it when edited, but cannot get a new made-up one', () => {
  const kept = validatePosting(good({ titleId: 'custom', title: 'Platform Reliability Lead' }), { ...ctx, existingTitle: 'Platform Reliability Lead' });
  assert.ok(!kept.errors.titleId); assert.strictEqual(kept.value.titleId, 'custom');
  const changed = validatePosting(good({ titleId: 'custom', title: 'Something Else' }), { ...ctx, existingTitle: 'Platform Reliability Lead' });
  assert.ok(changed.errors.titleId);
});
t('every skill needs a level chosen (or no minimum)', () => {
  only({ skills: [{ key: 'linux', minLevel: '' }] }, 'skills');
  const none = run({ skills: [{ key: 'linux', minLevel: 'none' }] });
  assert.ok(!none.errors.skills); assert.strictEqual(none.value.skills[0].minLevel, null); assert.strictEqual(none.value.seniorityLabel, 'Entry level');
});
t('Commission only is a pay type: base pay is $0 and no base-pay basis is needed', () => {
  const { errors, value } = run({ basePayType: 'commission', baseMin: '90000', baseMax: '99999', commissionMin: '20000', commissionAverage: '60000', commissionAck: 'on' });
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(value.commissionOnly, true); assert.strictEqual(value.baseMin, 0);
  assert.ok(only({ basePayType: 'commission', commissionMin: '', commissionAverage: '' }, 'commission'));   // commission figures still required
});
t('shifts: pick one or more; flexible stands alone; none is refused', () => {
  const two = run({ shifts: ['daytime', 'evenings'] });
  assert.deepStrictEqual(two.value.shifts, ['daytime', 'evenings']); assert.strictEqual(two.value.shift, 'daytime');
  assert.deepStrictEqual(run({ shifts: ['daytime', 'flexible'] }).value.shifts, ['flexible']);
  assert.deepStrictEqual(run({ shifts: undefined, shift: 'overnight' }).value.shifts, ['overnight']);   // older form posts
  only({ shifts: [], shift: '' }, 'shift');
  only({ shifts: ['moon'] }, 'shift');
});
t('the company website is required, cleaned to a bare domain, and must be the company\'s own', () => {
  const ok = run({});
  assert.strictEqual(ok.value.companyDomain, 'acme.com'); assert.strictEqual(ok.value.companyWebsite, 'https://acme.com');
  only({ companyWebsite: '' }, 'companyWebsite');
  only({ companyWebsite: 'not a site' }, 'companyWebsite');
  only({ companyWebsite: 'me@acme.com' }, 'companyWebsite');
  only({ companyWebsite: 'https://www.linkedin.com/company/acme' }, 'companyWebsite');
  assert.strictEqual(run({ companyWebsite: 'HTTP://Sub.Acme.co.uk/jobs' }).value.companyDomain, 'sub.acme.co.uk');
});
t('seniority comes from the highest minimum level', () => {
  assert.strictEqual(seniorityLabel([{ minLevel: null }]), 'Entry level');
  assert.strictEqual(seniorityLabel([{ minLevel: 'Foundational' }]), 'Junior');
  assert.strictEqual(seniorityLabel([{ minLevel: 'Advanced' }, { minLevel: 'Foundational' }]), 'Senior');
  assert.strictEqual(seniorityLabel([{ minLevel: 'Expert' }]), 'Expert');
  const { value } = run({ skills: [{ key: 'linux', minLevel: 'none' }, { key: 'cloud', minLevel: 'none' }] });
  assert.strictEqual(value.seniorityLabel, 'Entry level');
});

// company
t('company: required, real, authorization ticked', () => {
  only({ hiringCompany: '' }, 'hiringCompany');
  only({ hiringCompany: 'Confidential Client' }, 'hiringCompany');
  only({ hiringCompany: 'Undisclosed' }, 'hiringCompany');
  only({ hiringCompany: 'client' }, 'hiringCompany');
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
t('commission: two numbers, average not below minimum, figures required', () => {
  only({ commissionEnabled: 'on', commissionMin: '', commissionAverage: '' , commissionAck: 'on' }, 'commission');
  only({ commissionEnabled: 'on', commissionMin: '50000', commissionAverage: '40000', commissionAck: 'on' }, 'commission');
  const ok = run({ commissionEnabled: 'on', commissionMin: '20000', commissionAverage: '500000', commissionAck: 'on' });
  assert.deepStrictEqual(ok.errors, {}); // no cap on the average; the warning is the guard
  assert.ok(ok.value.commissionAckAt instanceof Date);
  assert.strictEqual(run({}).value.commissionAckAt, null);
});
t('benefits and the good-faith box are required', () => {
  only({ benefits: [] }, 'benefits');
  assert.deepStrictEqual(run({ benefits: [], noBenefits: 'on' }).errors, {});
  only({ benefits: ['health'], noBenefits: 'on' }, 'benefits');
  assert.deepStrictEqual(run({ benefits: [], benefitsOther: 'Free lunch Fridays' }).errors, {});
  only({ goodFaith: undefined, authorizedToRecruit: undefined, requirementsAttested: undefined, outcomeAck: undefined }, 'attest');
});
t('bonus, equity and tips are plain checkmarks, no notes', () => {
  const { value, errors } = run({ bonusOffered: 'on', bonusNote: 'a typed note is ignored', equityOffered: 'on' });
  assert.deepStrictEqual(errors, {});
  assert.deepStrictEqual(value.bonus, { offered: true, note: '' });
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
t('one confirmation on the last page covers authorization, pay, requirements and the outcome rule', () => {
  const none = { authorizedToRecruit: undefined, goodFaith: undefined, requirementsAttested: undefined, outcomeAck: undefined };
  only(none, 'attest');
  const all = run({ ...none, attest: 'on' });
  assert.deepStrictEqual(all.errors, {});
  for (const k of ['goodFaithAt', 'requirementsAttestedAt', 'outcomeAckAt']) assert.ok(all.value[k] instanceof Date, k);
  assert.strictEqual(all.value.authorizedToRecruit, true);
  const comm = run({ ...none, attest: 'on', commissionEnabled: 'on', commissionMin: '20000', commissionAverage: '40000' });
  assert.deepStrictEqual(comm.errors, {}); assert.ok(comm.value.commissionAckAt instanceof Date);
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
t('description: summary length, free-form responsibilities (20 to 2000 characters), bullets stripped', () => {
  only({ summary: 'Too short.' }, 'summary');
  only({ summary: 'x'.repeat(2001) }, 'summary');
  only({ responsibilities: 'Too short' }, 'responsibilities');
  only({ responsibilities: 'x'.repeat(2001) }, 'responsibilities');
  assert.strictEqual(run({ responsibilities: Array.from({ length: 20 }, (_, i) => `Responsibility number ${i + 1}`).join('\n') }).errors.responsibilities, undefined);
  const { value } = run({ responsibilities: '- Operate cloud infrastructure\n* Improve deploy pipelines\n1. Respond to incidents\n\n' });
  assert.deepStrictEqual(value.responsibilities, ['Operate cloud infrastructure', 'Improve deploy pipelines', 'Respond to incidents']);
});
t('the free-text scan blocks contact details, years, citizens only and age wording in every text field', () => {
  assert.match(only({ summary: 'Email jobs@acme.com to apply. ' + 'x'.repeat(60) }, 'summary'), /Email addresses/);
  assert.match(only({ responsibilities: 'Run servers\nCall 555-123-4567 today\nShip fast' }, 'responsibilities'), /Phone numbers/);
  assert.match(only({ summary: '5+ years of experience with Linux ' + 'x'.repeat(60) }, 'summary'), /Years of experience/);
  assert.match(only({ summary: 'US citizens only ' + 'x'.repeat(60) }, 'summary'), /authorized to work/);
  assert.match(only({ summary: 'A young, digital native team that ' + 'x'.repeat(60) }, 'summary'), /age, gender or nationality/);
  only({ benefits: [], benefitsOther: 'see www.perks.com' }, 'benefits');
  only({ employmentType: 'contract', contractLength: 'call 555-123-4567' }, 'contractLength');
});

t('several mistakes are all reported at once', () => {
  const { errors } = validatePosting({}, ctx);
  for (const f of ['skills', 'titleId', 'hiringCompany', 'employmentType', 'openings', 'arrangement', 'relocation',
    'travel', 'shift', 'basePayType', 'baseRange', 'benefits', 'attest', 'closeDate', 'startDate', 'summary', 'responsibilities']) {
    assert.ok(errors[f], 'no error for ' + f);
  }
});

console.log(`\n${n} tests passed`);
