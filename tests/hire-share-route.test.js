// The "I got a job" share routes: owner only, hired applications only, and nothing public until saved.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');
const qs = require('qs');
const Candidate = require('../src/models/Candidate');
const JobApplication = require('../src/models/JobApplication');
const JobPosting = require('../src/models/JobPosting');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

const APP_ID = '507f1f77bcf86cd799439055';
const me = new Candidate({ firstName: 'Kent', lastName: 'Mayer', slug: 'kent-mayer', email: 'k@example.com', phone: '+15555550100' });
let saves = 0;
me.save = async () => { saves++; };
let appStatus = 'hired';
Candidate.findOne = async ({ slug }) => (slug === 'kent-mayer' ? me : null);
Candidate.updateOne = async () => ({});
JobApplication.findOne = async (q) => (String(q._id) === APP_ID && q.status === 'hired' && appStatus === 'hired' ? { _id: APP_ID, jobId: '507f1f77bcf86cd799439077', candidateId: me._id } : null);
JobPosting.findById = async () => ({ title: 'DevOps Engineer', hiringCompany: 'Acme Corp' });

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
let sessionId = String(me._id);
app.use((req, res, next) => { req.session = sessionId ? { candidateId: sessionId } : {}; next(); });
app.use('/candidate', require('../src/routes/candidate-hire-share'));
app.use('/achievements', require('../src/routes/achievements'));

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p, { redirect: 'manual' });
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs.stringify(body) });
  const setup = `/candidate/kent-mayer/share-hire/${APP_ID}`;
  const pub = `/achievements/kent-mayer/hire/${APP_ID}`;

  await t('the setup page shows the company option and nothing is public yet', async () => {
    const res = await get(setup);
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(html.includes('Mention the company') && html.includes('Acme Corp'));
    assert.strictEqual((await get(pub)).status, 404);
  });

  await t('saving with no company makes a public page without the company name', async () => {
    const res = await post(setup, { on: '1', companyMode: 'none', hashtag: '#NewJob' });
    assert.strictEqual(res.status, 302);
    const page = await get(pub);
    const html = await page.text();
    assert.strictEqual(page.status, 200);
    assert.ok(html.includes('Kent M. got a new job') && !html.includes('Acme') && !html.includes('Mayer'));
  });

  await t('choosing the company puts it on the page, and stop sharing takes the page down', async () => {
    await post(setup, { on: '1', companyMode: 'company', hashtag: '' });
    assert.ok((await (await get(pub)).text()).includes('at Acme Corp'));
    await post(setup, { on: '0' });
    assert.strictEqual((await get(pub)).status, 404);
  });

  await t('only the owner, and only for a hired application', async () => {
    sessionId = '507f1f77bcf86cd799439999';
    assert.strictEqual((await get(setup)).status, 403);
    assert.strictEqual((await post(setup, { on: '1' })).status, 403);
    sessionId = '';
    assert.strictEqual((await get(setup)).status, 403);
    sessionId = String(me._id);
    appStatus = 'rejected';
    assert.strictEqual((await get(setup)).status, 404);
    appStatus = 'hired';
    assert.strictEqual((await get('/candidate/kent-mayer/share-hire/not-an-id')).status, 404);
  });

  server.close();
  console.log(`\n${n} hire share route tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
