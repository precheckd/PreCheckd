// Run: node tests/posting-edit.test.js
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const JobPosting = require('../src/models/JobPosting');
const { validatePosting } = require('../src/services/postingValidation');
const { docFromValue, formFromPosting, changedParts } = require('../src/services/postingEdit');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

const NOW = new Date('2026-10-22T16:00:00Z').getTime();
const skillLabels = new Map([['linux', 'Linux'], ['cloud', 'Cloud'], ['agile', 'Agile']]);
const ctx = { now: NOW, skillLabels };
const base = (over = {}) => ({
  skills: [{ key: 'linux', minLevel: 'Intermediate' }, { key: 'cloud', minLevel: '' }],
  titleId: 'cloud-engineer', nickname: 'x', hiringCompany: 'Acme Corp', authorizedToRecruit: 'on', employmentType: 'full_time', openings: '2',
  arrangement: 'hybrid', inOfficeDays: '3', address: '1 Main St, Boston, MA', relocation: 'yes', travel: 'occasional', shift: 'evenings',
  basePayType: 'salary', baseMin: '100000', baseMax: '120000', payBasis: ['skill_level', 'location'],
  commissionEnabled: 'on', commissionMin: '10000', commissionAverage: '30000', commissionAck: 'on',
  bonusOffered: 'on', bonusNote: '10% of salary', equityOffered: 'on', benefits: ['health', '401k'], benefitsOther: 'Lunch', goodFaith: 'on',
  education: 'bachelor', certGroups: [['comptia-security-plus', 'isc2-cissp'], ['aws-cloud-practitioner']], clearance: 'secret',
  closeDate: '2026-11-15', startDate: '2026-12-07', startFirm: 'on', requirementsAttested: 'on',
  summary: 'Run and improve our cloud platform with a small, friendly team that ships every week.',
  responsibilities: 'Operate cloud infrastructure\nImprove deploy pipelines\nRespond to incidents', team: 'Platform team', growth: 'Lead path',
  ...over,
});
const location = { areaRule: { point: [-71.0589, 42.3601] }, areaLabel: 'Boston, MA', displayCity: 'Boston', displayState: 'MA' };
const saveAs = (body, loc = location) => {
  const { errors, value } = validatePosting(body, ctx);
  assert.deepStrictEqual(errors, {});
  const p = new JobPosting({ recruiterId: '507f1f77bcf86cd799439011', ...docFromValue(value, loc) });
  p.createdAt = new Date(NOW);
  assert.strictEqual(p.validateSync(), undefined);
  return p;
};

t('the edit form is filled from the saved posting and passes the same validation unchanged', () => {
  const p = saveAs(base());
  const form = formFromPosting(p);
  assert.strictEqual(form.hiringCompany, 'Acme Corp');
  assert.strictEqual(form.closeDate, '2026-11-15');
  assert.strictEqual(form.startDate, '2026-12-07');
  assert.deepStrictEqual(form.skills[0], { key: 'linux', minLevel: 'Intermediate' });
  assert.deepStrictEqual(form.skills[2], { key: '', minLevel: '' });
  assert.strictEqual(form.certGroups.length, 3);
  assert.deepStrictEqual(form.certGroups[0], ['comptia-security-plus', 'isc2-cissp', '', '', '']);
  assert.strictEqual(form.relocation, 'yes');
  assert.strictEqual(form.responsibilities, 'Operate cloud infrastructure\nImprove deploy pipelines\nRespond to incidents');
  // nothing tripped by the round trip, once the commission statement is confirmed again
  const again = validatePosting({ ...form, commissionAck: 'on' }, { ...ctx, editing: { createdAt: p.createdAt } });
  assert.deepStrictEqual(again.errors, {});
  assert.deepStrictEqual(changedParts(p, docFromValue(again.value, location)), []);
});

t('the commission confirmation is never pre-ticked, so it must be given again', () => {
  const p = saveAs(base());
  const form = formFromPosting(p);
  assert.strictEqual(form.commissionAck, undefined);
  assert.strictEqual(form.commissionEnabled, 'on');
  const { errors } = validatePosting(form, { ...ctx, editing: { createdAt: p.createdAt } });
  assert.ok(errors.commissionAck);
  assert.strictEqual(form.goodFaith, 'on');
  assert.strictEqual(form.requirementsAttested, 'on');
});

t('a commission-only posting round-trips', () => {
  const p = saveAs(base({ commissionOnly: 'on', commissionEnabled: undefined, basePayType: undefined, baseMin: undefined, baseMax: undefined, arrangement: 'remote', address: '', inOfficeDays: '' }));
  const form = formFromPosting(p);
  assert.strictEqual(form.commissionOnly, 'on');
  assert.strictEqual(form.baseMin, '');
  const again = validatePosting({ ...form, commissionAck: 'on' }, { ...ctx, editing: { createdAt: p.createdAt } });
  assert.deepStrictEqual(again.errors, {});
});

t('remote in area (states and radius) round-trip', () => {
  const s = saveAs(base({ arrangement: 'remote_in_area', areaReason: 'states', states: ['NY', 'NJ'], address: '', inOfficeDays: '' }), { areaRule: { states: ['NY', 'NJ'] }, areaLabel: 'NY, NJ' });
  assert.deepStrictEqual(formFromPosting(s).states, ['NY', 'NJ']);
  const r = saveAs(base({ arrangement: 'remote_in_area', areaReason: 'radius', radiusMiles: '40', inOfficeDays: '' }), { areaRule: { point: [-71.06, 42.36], radiusMiles: 40 }, areaLabel: 'Boston, MA' });
  assert.strictEqual(formFromPosting(r).radiusMiles, '40');
});

t('changedParts names what an edit changed', () => {
  const p = saveAs(base());
  const edit = (over) => {
    const { errors, value } = validatePosting(base(over), ctx);
    assert.deepStrictEqual(errors, {});
    return changedParts(p, docFromValue(value, location));
  };
  assert.deepStrictEqual(edit({}), []);
  assert.deepStrictEqual(edit({ summary: 'A different summary that is long enough to pass the minimum character count rule here.' }), ['description']);
  assert.deepStrictEqual(edit({ baseMax: '124000' }), ['pay']);
  assert.deepStrictEqual(edit({ education: 'master' }), ['requirements']);
  assert.deepStrictEqual(edit({ closeDate: '2026-11-20' }), ['dates']);
  assert.deepStrictEqual(edit({ openings: '3' }), ['job details']);
  assert.deepStrictEqual(edit({ shift: 'overnight' }), ['location']);
  assert.deepStrictEqual(edit({ hiringCompany: 'Beta Inc' }), ['company']);
  assert.deepStrictEqual(edit({ nickname: 'renamed' }), []); // the internal label is not a change candidates could notice
  assert.deepStrictEqual(edit({ education: 'master', baseMax: '124000' }).sort(), ['pay', 'requirements']);
});

t('editing mode close date: may stay today, may extend up to 45 days from the first posting, never the past', () => {
  const created = new Date(NOW);
  const e = (closeDate, now = NOW) => validatePosting(base({ closeDate, startDate: '2027-01-15' }), { ...ctx, now, editing: { createdAt: created } }).errors.closeDate;
  assert.strictEqual(e('2026-12-06'), undefined);                       // 45 days after Oct 22
  assert.ok(e('2026-12-07'));                                           // 46
  assert.strictEqual(e('2026-10-30', new Date('2026-10-30T15:00:00Z').getTime()), undefined); // closes today: still editable
  assert.ok(e('2026-10-29', new Date('2026-10-30T15:00:00Z').getTime())); // in the past
  assert.strictEqual(e('2026-12-06', new Date('2026-11-20T15:00:00Z').getTime()), undefined); // limit counts from first posting, not from now
  // creating still needs a future day
  assert.ok(validatePosting(base({ closeDate: '2026-10-22' }), ctx).errors.closeDate);
});

console.log(`\n${n} tests passed`);
