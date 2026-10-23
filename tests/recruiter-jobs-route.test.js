// Run: node tests/recruiter-jobs-route.test.js
// Drives the recruiter job routes through a real Express app with the database layer stubbed (no MongoDB
// here). Saved postings are built as real JobPosting documents and schema-validated.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.DISABLE_JOB_NOTICES = 'true';
process.env.MOCK_EMAIL = 'true';
process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'https://example.test';
const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');
const qs = require('qs');
const axios = require('axios');

const Recruiter = require('../src/models/Recruiter');
const JobPosting = require('../src/models/JobPosting');
const SkillAssessment = require('../src/models/SkillAssessment');
const CatalogRequest = require('../src/models/CatalogRequest');
const JobApplication = require('../src/models/JobApplication');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

// ---- stubs ----
let recruiter = { _id: '507f1f77bcf86cd799439011', accountTier: 'standard', isActive: true, isIdentityVerified: true, isPhoneVerified: true, isSuspended: false };
Recruiter.findById = async () => recruiter;
SkillAssessment.find = async () => [{ skills: [{ key: 'linux', label: 'Linux' }, { key: 'cloud', label: 'Cloud' }, { key: 'agile', label: 'Agile' }] }];
const saved = [];
JobPosting.create = async (doc) => {
  const p = new JobPosting(doc);
  const bad = p.validateSync();
  if (bad) throw bad;
  saved.push(p);
  return p;
};
JobPosting.find = () => { const p = Promise.resolve(saved.slice()); p.sort = async () => saved.slice(); return p; };
JobPosting.findById = async (id) => saved.find((p) => String(p._id) === String(id)) || null;
JobPosting.distinct = async () => ['Acme Corp', 'ACME corp', 'Acme Labs'];
JobApplication.find = () => { const p = Promise.resolve([]); p.populate = async () => []; return p; };
JobApplication.countDocuments = async () => 0;
require('../src/models/ConnectionRequest').find = () => { const p = Promise.resolve([]); p.populate = async () => []; return p; };
const catalogWrites = [];
CatalogRequest.updateOne = async (...args) => { catalogWrites.push(args); return {}; };
Object.defineProperty(JobPosting.prototype, 'save', { value: async function () { return this; }, configurable: true, writable: true });

let geocodeCalls = 0;
let geocodeMode = 'ok';
axios.get = async (url) => {
  geocodeCalls++;
  if (geocodeMode === 'fail') return { data: { result: { addressMatches: [] } } };
  return { data: { result: { addressMatches: [{ coordinates: { x: -71.0589, y: 42.3601 }, addressComponents: { city: 'BOSTON', state: 'MA' } }] } } };
};

// ---- app ----
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => { req.session = { recruiterId: '507f1f77bcf86cd799439011' }; next(); });
app.use('/recruiter-jobs', require('../src/routes/recruiter-jobs'));

const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const validForm = (over = {}) => ({
  skills: [{ key: 'linux', minLevel: 'Intermediate' }, { key: 'cloud', minLevel: '' }, { key: '', minLevel: '' }],
  titleId: 'cloud-engineer', nickname: 'Acme cloud', hiringCompany: 'Acme Corp', authorizedToRecruit: 'on',
  employmentType: 'full_time', openings: '1', arrangement: 'onsite', address: '1 Main St, Boston, MA',
  relocation: 'no', travel: 'none', shift: 'daytime', basePayType: 'salary', baseMin: '100000', baseMax: '120000',
  payBasis: ['skill_level'], benefits: ['health'], goodFaith: 'on',
  education: 'bachelor', certGroups: [['comptia-security-plus', 'isc2-cissp', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']], clearance: '',
  closeDate: soon(20), startDate: soon(40), startFirm: 'on', requirementsAttested: 'on', outcomeAck: 'on',
  summary: 'Run and improve our cloud platform with a small, friendly team that ships every week.',
  responsibilities: 'Operate cloud infrastructure\nImprove deploy pipelines\nRespond to incidents', team: '', growth: '',
  ...over,
});

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p, { redirect: 'manual' });
  const post = (p, body, json) => fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: json ? JSON.stringify(body) : qs.stringify(body),
  });

  await t('GET /new shows the form with the skills we can test', async () => {
    const res = await get('/recruiter-jobs/new');
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(html.includes('Post a job') && html.includes('<option value="linux"') && html.includes('name="skills[0][key]"'));
    assert.ok(html.includes('CompTIA Security+') && html.includes('Remote in Area'));
  });

  await t('GET /titles offers titles that cover every picked skill', async () => {
    const data = await (await get('/recruiter-jobs/titles?skills=linux,agile,cloud')).json();
    assert.deepStrictEqual(data.titles.map((x) => x.id), ['devops-engineer']);
    assert.deepStrictEqual((await (await get('/recruiter-jobs/titles?skills=')).json()).titles, []);
  });

  await t('GET /companies de-duplicates by name', async () => {
    assert.deepStrictEqual((await (await get('/recruiter-jobs/companies?q=acme')).json()).companies, ['Acme Corp', 'Acme Labs']);
    assert.deepStrictEqual((await (await get('/recruiter-jobs/companies?q=a')).json()).companies, []);
  });

  await t('a valid on-site posting is saved with a private address, a geocoded rule and a public city', async () => {
    const res = await post('/recruiter-jobs/new', validForm());
    assert.strictEqual(res.status, 302, await res.clone().text());
    assert.match(res.headers.get('location'), /^\/recruiter-jobs\/[0-9a-f]{24}\?posted=1$/);
    assert.strictEqual(saved.length, 1);
    const p = saved[0];
    assert.strictEqual(p.title, 'Cloud Engineer');
    assert.strictEqual(p.seniorityLabel, 'Mid-level');
    assert.strictEqual(p.address, '1 Main St, Boston, MA');
    assert.deepStrictEqual(Array.from(p.areaRule.point), [-71.0589, 42.3601]);
    assert.strictEqual(p.displayCity, 'Boston');
    assert.strictEqual(p.displayState, 'MA');
    assert.strictEqual(p.status, 'open');
    assert.strictEqual(p.source, 'precheckd');
    assert.strictEqual(p.certGroups[0].certs.length, 2);
    // the gate reads it correctly
    const g = p.toGateShape();
    assert.strictEqual(g.education, 3);
    assert.strictEqual(g.clearance, null);
    assert.deepStrictEqual(g.certGroups[0].map((c) => c.catalogId), ['comptia-security-plus', 'isc2-cissp']);
    assert.deepStrictEqual(g.areaRule.point, [-71.0589, 42.3601]);
    assert.strictEqual(g.startFirm, true);
    assert.ok(g.closeDate instanceof Date);
  });

  await t('the new gate shape works end to end with the rules engine', async () => {
    const gate = require('../src/services/applyGate');
    const g = saved[0].toGateShape();
    const r = gate.evaluate({ verified: { email: true, phone: true, identity: true }, skills: [], areaMatch: null, shifts: [] }, g);
    const codes = r.blockers.map((b) => b.code);
    assert.ok(codes.includes('skill_missing') && codes.includes('education_missing') && codes.includes('cert_missing') && codes.includes('shift_missing') && codes.includes('area_unset'), codes.join());
  });

  await t('a remote-in-area posting by states saves without any lookup', async () => {
    geocodeCalls = 0;
    const res = await post('/recruiter-jobs/new', validForm({ arrangement: 'remote_in_area', areaReason: 'states', states: ['NY', 'NJ'], address: '' }));
    assert.strictEqual(res.status, 302, await res.clone().text());
    assert.strictEqual(geocodeCalls, 0);
    const p = saved[1];
    assert.deepStrictEqual(Array.from(p.areaRule.states), ['NY', 'NJ']);
    assert.strictEqual(p.areaLabel, 'NY and NJ');
    assert.strictEqual(p.address, '');
  });

  await t('a commission-only posting saves with base pay 0', async () => {
    const res = await post('/recruiter-jobs/new', validForm({ arrangement: 'remote', address: '', commissionOnly: 'on', basePayType: undefined, baseMin: undefined, baseMax: undefined, commissionMin: '20000', commissionAverage: '70000', commissionAck: 'on' }));
    assert.strictEqual(res.status, 302, await res.clone().text());
    const p = saved[2];
    assert.strictEqual(p.baseMax, 0);
    assert.strictEqual(p.commissionOnly, true);
    assert.strictEqual(p.commission.average, 70000);
    assert.ok(p.commissionAckAt instanceof Date);
  });

  await t('mistakes re-show the form with every problem and the recruiter\'s answers kept', async () => {
    const before = saved.length;
    const res = await post('/recruiter-jobs/new', validForm({ summary: 'Short', hiringCompany: 'Keep Me Inc', goodFaith: undefined, baseMax: '200000' }));
    const html = await res.text();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(saved.length, before);
    assert.ok(html.includes('Please fix 3 things'), html.match(/Please fix[^<]*/));
    assert.ok(html.includes('value="Keep Me Inc"'));
    assert.ok(html.includes('at most 25% above'));
    assert.ok(html.includes('<option value="linux" selected>'));
    assert.ok(/name="titleId" value="cloud-engineer" checked/.test(html));
  });

  await t('contact details in the description are refused with the reason', async () => {
    const res = await post('/recruiter-jobs/new', validForm({ summary: 'Email me at jobs@acme.com for details about this great cloud role on our team today.' }));
    const html = await res.text();
    assert.strictEqual(res.status, 400);
    assert.ok(html.includes('Email addresses are not allowed'));
  });

  await t('an address that cannot be found is reported on the address field', async () => {
    geocodeMode = 'fail';
    const res = await post('/recruiter-jobs/new', validForm());
    const html = await res.text();
    geocodeMode = 'ok';
    assert.strictEqual(res.status, 400);
    assert.ok(html.includes('could not find that address'));
  });

  await t('request-title tells staff which skills had no title', async () => {
    const res = await post('/recruiter-jobs/request-title', { skills: [{ key: 'linux' }, { key: 'agile' }] }, true);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(catalogWrites.length, 1);
    const [filter, update] = catalogWrites[0];
    assert.strictEqual(filter.kind, 'job_title');
    assert.strictEqual(update.$setOnInsert.detail, 'Linux, Agile');
    assert.strictEqual((await post('/recruiter-jobs/request-title', { skills: [] }, true)).status, 400);
  });

  await t('My postings lists them; the detail page shows the private address to its owner', async () => {
    const list = await (await get('/recruiter-jobs')).text();
    assert.ok(list.includes('Cloud Engineer') && list.includes('Boston, MA') && list.includes('Acme Corp'));
    const detail = await get(`/recruiter-jobs/${saved[0]._id}?posted=1`);
    const html = await detail.text();
    assert.strictEqual(detail.status, 200);
    assert.ok(html.includes('Your job is posted') && html.includes('1 Main St, Boston, MA') && html.includes('CompTIA Security+, CISSP'));
    assert.ok(html.includes('equal opportunity employer') && html.includes('End this posting early'));
    assert.ok(html.includes('Starts ') && html.includes('(firm)'));
  });

  await t('someone else\'s posting and made-up ids are not found', async () => {
    saved[0].recruiterId = '507f1f77bcf86cd799439099';
    assert.strictEqual((await get(`/recruiter-jobs/${saved[0]._id}`)).status, 404);
    saved[0].recruiterId = '507f1f77bcf86cd799439011';
    assert.strictEqual((await get('/recruiter-jobs/not-an-id')).status, 404);
  });

  // ---- editing an open posting ----
  const editPath = () => `/recruiter-jobs/${saved[0]._id}/edit`;
  const editForm = (over = {}) => validForm({ commissionAck: undefined, ...over });

  await t('the edit form opens filled in, with the private address and a re-confirm note', async () => {
    const res = await get(editPath());
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(html.includes('1 Main St, Boston, MA') && html.includes('Acme Corp') && html.includes('Save changes'));
    assert.ok(html.includes(`action="${editPath()}"`));
  });

  await t('saving an edit with the same address does not look the address up again', async () => {
    geocodeCalls = 0;
    const before = saved[0].areaRule.point.slice();
    const res = await post(editPath(), editForm({ baseMax: '125000' }));
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.get('location').endsWith('?saved=1'));
    assert.strictEqual(geocodeCalls, 0);
    assert.strictEqual(saved[0].baseMax, 125000);
    assert.deepStrictEqual(saved[0].areaRule.point.slice(), before);
    assert.ok(saved[0].editedAt instanceof Date);
    assert.deepStrictEqual(saved[0].edits.map((e) => e.parts), [['pay']]);
  });

  await t('a changed address is looked up again', async () => {
    geocodeCalls = 0;
    const res = await post(editPath(), editForm({ baseMax: '125000', address: '9 Elm St, Boston, MA' }));
    assert.strictEqual(res.status, 302);
    assert.ok(geocodeCalls >= 1);
    assert.strictEqual(saved[0].address, '9 Elm St, Boston, MA');
    assert.deepStrictEqual(saved[0].edits.map((e) => e.parts)[1], ['location']);
    await post(editPath(), editForm({ baseMax: '125000' })); // put it back
    assert.strictEqual(saved[0].address, '1 Main St, Boston, MA');
  });

  await t('saving with nothing changed says so and logs nothing', async () => {
    const count = saved[0].edits.length;
    const res = await post(editPath(), editForm({ baseMax: '125000' }));
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.get('location').endsWith('?saved=nochange'));
    assert.strictEqual(saved[0].edits.length, count);
  });

  await t('a mistake on the edit form re-shows it with the answers kept and saves nothing', async () => {
    const count = saved[0].edits.length;
    const res = await post(editPath(), editForm({ baseMax: '500000', summary: 'Email me at a@b.co for details of this role' }));
    const html = await res.text();
    assert.strictEqual(res.status, 400);
    assert.ok(html.includes('Save changes') && html.includes('500000'));
    assert.strictEqual(saved[0].edits.length, count);
    assert.strictEqual(saved[0].baseMax, 125000);
  });

  await t('commission must be confirmed again on every edit', async () => {
    const withCommission = editForm({ commissionEnabled: 'on', commissionMin: '5000', commissionAverage: '20000' });
    const res = await post(editPath(), withCommission);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.text()).toLowerCase().includes('commission'));
    const ok = await post(editPath(), { ...withCommission, commissionAck: 'on' });
    assert.strictEqual(ok.status, 302);
    assert.strictEqual(saved[0].commission.average, 20000);
    assert.ok(saved[0].commissionAckAt instanceof Date);
  });

  await t('the detail page shows the edit button, the saved banner and the edit log', async () => {
    const html = await (await get(`/recruiter-jobs/${saved[0]._id}?saved=1`)).text();
    assert.ok(html.includes('Edit this posting') && html.includes('Changes saved.') && html.includes('Last edited'));
    assert.ok((await (await get(`/recruiter-jobs/${saved[0]._id}?saved=nochange`)).text()).includes('Nothing was changed.'));
  });

  await t('someone else\'s posting cannot be edited', async () => {
    saved[0].recruiterId = '507f1f77bcf86cd799439099';
    assert.strictEqual((await get(editPath())).status, 404);
    assert.strictEqual((await post(editPath(), editForm())).status, 404);
    saved[0].recruiterId = '507f1f77bcf86cd799439011';
  });

  await t('closing a posting', async () => {
    const res = await post(`/recruiter-jobs/${saved[0]._id}/outcome`, { kind: 'cancelled', reason: 'budget' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(saved[0].status, 'closed');
    assert.ok(saved[0].closedAt instanceof Date);
  });

  await t('a closed posting cannot be edited', async () => {
    const before = saved[0].baseMax;
    const g = await get(editPath());
    assert.strictEqual(g.status, 409);
    assert.ok((await g.text()).includes('can no longer be edited'));
    assert.strictEqual((await post(editPath(), editForm({ baseMax: '126000' }))).status, 409);
    assert.strictEqual(saved[0].baseMax, before);
    assert.ok(!(await (await get(`/recruiter-jobs/${saved[0]._id}`)).text()).includes('Edit this posting'));
  });

  await t('an unverified, inactive or suspended recruiter cannot post', async () => {
    const original = recruiter;
    for (const patch of [{ isIdentityVerified: false }, { isActive: false }, { isSuspended: true }, { accountTier: 'unverified_claim' }, { isPhoneVerified: false }]) {
      recruiter = { ...original, ...patch };
      const res = await get('/recruiter-jobs/new');
      assert.strictEqual(res.status, 403, JSON.stringify(patch));
      assert.ok((await res.text()).includes('Finish verification'));
      assert.strictEqual((await post('/recruiter-jobs/new', validForm())).status, 403);
    }
    recruiter = original;
  });

  server.close();
  console.log(`\n${n} tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
