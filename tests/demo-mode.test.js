// Demo mode: what is blocked, what is allowed, and that the lockdown cannot be bypassed by copied keys.
const assert = require('assert');
const http = require('http');
const express = require('express');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

function get(port, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port, method, path, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers })); });
    r.on('error', reject); r.end();
  });
}

(async () => {
  process.env.DEMO_MODE = 'true';
  process.env.RESEND_API_KEY = 're_real_key'; process.env.STRIPE_SECRET_KEY = 'sk_live_real'; process.env.BILLING_ENABLED = 'true'; process.env.CODERBYTE_API_KEY = 'cb_real';
  const demo = require('../src/config/demo');
  demo.lockDown();
  const { demoMode } = require('../src/middleware/demoMode');

  await t('lockdown replaces real keys and turns off billing, email, SMS, ID checks and jobs', () => {
    assert.strictEqual(process.env.RESEND_API_KEY, 're_demo_disabled');
    assert(/demo_disabled/.test(process.env.STRIPE_SECRET_KEY));
    assert.strictEqual(process.env.BILLING_ENABLED, undefined);
    assert.strictEqual(process.env.CODERBYTE_API_KEY, undefined);
    for (const k of ['MOCK_EMAIL', 'MOCK_SMS', 'MOCK_IDENTITY', 'DISABLE_JOBS']) assert.strictEqual(process.env[k], 'true');
  });

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', require('path').join(__dirname, '..', 'views'));
  app.use(demoMode());
  app.all('*', (req, res) => res.send('reached:' + req.path));
  const server = app.listen(0); const port = server.address().port;

  await t('reading pages works and carries noindex', async () => {
    const r = await get(port, 'GET', '/candidate-search');
    assert.strictEqual(r.status, 200); assert(/noindex/.test(r.headers['x-robots-tag']));
  });
  await t('robots.txt disallows everything', async () => {
    const r = await get(port, 'GET', '/robots.txt'); assert(/Disallow: \//.test(r.body));
  });
  await t('changes are refused (login, apply, post a job, messages, Stripe webhook, API)', async () => {
    for (const [m, p] of [['POST', '/login'], ['POST', '/jobs/123/apply'], ['POST', '/recruiter-jobs/new'], ['POST', '/messages/send'], ['DELETE', '/connections/1'], ['PUT', '/candidate/x/edit']]) {
      const r = await get(port, m, p); assert.strictEqual(r.status, 403, m + ' ' + p); assert(!/reached:/.test(r.body));
    }
    const api = await get(port, 'POST', '/api/ask-chat', { accept: 'application/json' });
    assert.strictEqual(api.status, 403); assert(JSON.parse(api.body).demo === true);
    assert.strictEqual((await get(port, 'POST', '/webhooks/stripe')).status, 404);
  });
  await t('the demo logins and the two access requests are allowed', async () => {
    for (const p of ['/demo/recruiter', '/demo/candidate', '/candidate-search/AB12CD/connect', '/recruiter-dashboard/requests/' + 'a'.repeat(24) + '/request-full-access']) {
      const r = await get(port, 'POST', p); assert.strictEqual(r.status, 200, p); assert(/reached:/.test(r.body));
    }
  });
  await t('lookalike paths are not allowed', async () => {
    for (const p of ['/demo/recruiter/x', '/candidate-search/AB12CD/connect/extra', '/recruiter-dashboard/requests/zzz/request-full-access', '/recruiter-dashboard/requests/' + 'a'.repeat(24) + '/accept']) {
      assert.strictEqual((await get(port, 'POST', p)).status, 403, p);
    }
  });
  await t('staff host is hidden', async () => {
    const r = await get(port, 'GET', '/login', { host: 'admin.precheckd.com' }); assert.strictEqual(r.status, 404);
  });
  server.close();

  await t('does nothing when DEMO_MODE is off', async () => {
    process.env.DEMO_MODE = 'false';
    const a2 = express(); a2.use(demoMode()); a2.all('*', (req, res) => res.send('reached'));
    const s2 = a2.listen(0); const r = await get(s2.address().port, 'POST', '/login'); s2.close();
    assert.strictEqual(r.status, 200); assert(!r.headers['x-robots-tag']);
    process.env.DEMO_MODE = 'true';
  });

  await t('auto-approval only runs in the demo', async () => {
    const ConnectionRequest = require('../src/models/ConnectionRequest');
    const calls = [];
    const orig = ConnectionRequest.findOneAndUpdate;
    ConnectionRequest.findOneAndUpdate = async (...a) => { calls.push(a); return { ok: 1 }; };
    const approvals = require('../src/services/demoApprovals');
    await approvals.approveConnection('c', 'r');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][1].$set.status, 'accepted'); assert.strictEqual(calls[0][1].$set['contactShared.candidate.email'], true);
    process.env.DEMO_MODE = 'false';
    await approvals.approveConnection('c', 'r');
    const req = { fullAccessStatus: 'requested', save: async () => {} };
    await approvals.grantFullAccess(req);
    assert.strictEqual(calls.length, 1); assert.strictEqual(req.fullAccessStatus, 'requested');
    process.env.DEMO_MODE = 'true';
    await approvals.grantFullAccess(req); assert.strictEqual(req.fullAccessStatus, 'granted');
    ConnectionRequest.findOneAndUpdate = orig;
  });

  await t('demo pages render', async () => {
    const ejs = require('ejs'); const path = require('path');
    const a = await ejs.renderFile(path.join(__dirname, '../views/demo-landing.ejs'), { signupUrl: 'https://x/y', candidateSignupUrl: 'https://x/c' });
    assert(/Try the recruiter demo/.test(a) && /Start your founding spot/.test(a));
    const b = await ejs.renderFile(path.join(__dirname, '../views/demo-blocked.ejs'), { message: 'm', signupUrl: 'https://x/y' });
    assert(/turned off in the demo/.test(b));
  });

  await t('the demo keeps its sessions in its own database', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/app.js'), 'utf8');
    assert(/enabled\(\) \? \{ dbName: process\.env\.MONGODB_DB_NAME \} : \{\}/.test(src));
  });

  await t('the connect page shows the instant approval in the demo', () => {
    const fs = require('fs'); const p = require('path');
    assert(/demoApprovedId: demoApproved/.test(fs.readFileSync(p.join(__dirname, '../src/routes/candidate-search.js'), 'utf8')));
    const v = fs.readFileSync(p.join(__dirname, '../views/candidate-search-profile.ejs'), 'utf8');
    assert(/data\.demoApprovedId/.test(v) && /Request Accepted/.test(v));
  });

  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
