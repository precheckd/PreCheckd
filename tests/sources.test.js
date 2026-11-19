// Link sources: tagged links are counted once per visitor, remembered for signup, and shown to staff.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ejs = require('ejs');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const SourceVisit = require('../src/models/SourceVisit');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const sources = require('../src/services/sources');

const calls = [];
SourceVisit.updateOne = async (...a) => { calls.push(a); return {}; };

const request = (port, method, p, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ port, method, path: p, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
  r.on('error', reject); r.end();
});
function appWith(mount) {
  const sessions = {};
  const app = express();
  app.use((req, res, next) => { const id = req.get('x-visitor') || 'v1'; req.session = sessions[id] = sessions[id] || {}; next(); });
  mount(app);
  app.all('*', (req, res) => res.send('page'));
  return { app, sessions };
}

(async () => {
  await t('tags are cleaned and bad ones refused', () => {
    assert.strictEqual(sources.clean(' Li-DM '), 'li-dm');
    assert.strictEqual(sources.clean('li_post_2'), 'li_post_2');
    for (const bad of ['', null, undefined, '../x', 'a b', '<script>', 'x'.repeat(41), '-lead', ['a', 'b']]) assert.strictEqual(sources.clean(bad), null, String(bad));
  });

  await t('a visit is one daily counter, created on first use', async () => {
    calls.length = 0;
    assert.strictEqual(await sources.record('Li-DM', 'demo', new Date('2026-11-19T03:00:00Z')), true);
    const [filter, update, opts] = calls[0];
    assert.deepStrictEqual(filter, { src: 'li-dm', target: 'demo', day: '2026-11-18' }); // 10pm Eastern the evening before
    assert.deepStrictEqual(update, { $inc: { count: 1 } }); assert.strictEqual(opts.upsert, true);
    assert.strictEqual(await sources.record('bad tag!', 'demo'), false); assert.strictEqual(calls.length, 1);
  });

  await t('?src= on any page counts once per visitor and is remembered', async () => {
    calls.length = 0;
    const { app, sessions } = appWith((a) => a.use(sources.middleware()));
    const s = app.listen(0); const port = s.address().port;
    await request(port, 'GET', '/?src=li-post'); await request(port, 'GET', '/jobs?src=li-post'); await request(port, 'GET', '/?src=li-post');
    assert.strictEqual(calls.length, 1); assert.strictEqual(sessions.v1.src, 'li-post'); assert.strictEqual(calls[0][0].target, 'site');
    await request(port, 'GET', '/?src=li-dm'); assert.strictEqual(calls.length, 2); assert.strictEqual(sessions.v1.src, 'li-dm');
    await request(port, 'GET', '/?src=li-post', { 'x-visitor': 'v2' }); assert.strictEqual(calls.length, 3);
    await request(port, 'POST', '/login?src=zzz'); await request(port, 'GET', '/about'); await request(port, 'GET', '/?src=bad%20tag'); await request(port, 'GET', '/?src=');
    assert.strictEqual(calls.length, 3); s.close();
  });

  await t('the demo site never counts (its database is wiped nightly)', async () => {
    calls.length = 0; process.env.DEMO_MODE = 'true';
    const { app } = appWith((a) => a.use(sources.middleware())); const s = app.listen(0);
    await request(s.address().port, 'GET', '/?src=li-post'); s.close(); process.env.DEMO_MODE = 'false';
    assert.strictEqual(calls.length, 0);
  });

  await t('/go/<tag> counts a demo visit and sends the visitor to the demo site', async () => {
    calls.length = 0; delete process.env.DEMO_SITE_URL;
    const { app, sessions } = appWith((a) => a.use('/go', require('../src/routes/go'))); const s = app.listen(0); const port = s.address().port;
    const r = await request(port, 'GET', '/go/li-dm');
    assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.location, 'https://demo.precheckd.com/demo');
    assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0][0].target, 'demo'); assert.strictEqual(sessions.v1.src, 'li-dm');
    await request(port, 'GET', '/go/li-dm'); assert.strictEqual(calls.length, 1);
    const bad = await request(port, 'GET', '/go/bad%20tag'); assert.strictEqual(bad.status, 302); assert.strictEqual(calls.length, 1);
    process.env.DEMO_SITE_URL = 'https://demo.example.test/'; const o = await request(port, 'GET', '/go/other'); assert.strictEqual(o.headers.location, 'https://demo.example.test/demo');
    delete process.env.DEMO_SITE_URL; s.close();
  });

  await t('precheckd.com/demo and /demo/<tag> are the friendly links, and /go still works', async () => {
    calls.length = 0;
    const src = read('src/app.js');
    assert(/if \(!require\('\.\/config\/demo'\)\.enabled\(\)\) app\.use\('\/demo', require\('\.\/routes\/go'\)\)/.test(src) && /app\.use\('\/go'/.test(src));
    const { app } = appWith((a) => a.use('/demo', require('../src/routes/go'))); const s = app.listen(0); const port = s.address().port;
    const plain = await request(port, 'GET', '/demo'); assert.strictEqual(plain.status, 302); assert.strictEqual(plain.headers.location, 'https://demo.precheckd.com/demo'); assert.strictEqual(calls.length, 0);
    const tagged = await request(port, 'GET', '/demo/li-dm'); assert.strictEqual(tagged.status, 302); assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0][0].src, 'li-dm');
    s.close();
  });

  await t('link-preview robots and HEAD requests are not counted', async () => {
    calls.length = 0;
    const { app } = appWith((a) => { a.use(sources.middleware()); a.use('/go', require('../src/routes/go')); }); const s = app.listen(0); const port = s.address().port;
    for (const ua of ['LinkedInBot/1.0 (compatible; Mozilla/5.0)', 'Slackbot-LinkExpanding 1.0', 'facebookexternalhit/1.1', 'WhatsApp/2.23']) {
      await request(port, 'GET', '/?src=li-bot', { 'user-agent': ua, 'x-visitor': ua });
      const r = await request(port, 'GET', '/go/li-bot', { 'user-agent': ua, 'x-visitor': ua }); assert.strictEqual(r.status, 302);
    }
    await request(port, 'HEAD', '/go/li-bot');
    assert.strictEqual(calls.length, 0);
    await request(port, 'GET', '/go/li-bot', { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'x-visitor': 'real' });
    assert.strictEqual(calls.length, 1); s.close();
  });

  await t('new recruiter and candidate accounts record the tag', () => {
    assert(/source: \(req\.session && req\.session\.src\) \|\| null/.test(read('src/routes/founding-recruiter.js')));
    assert(/source: \(req\.session && req\.session\.src\) \|\| null/.test(read('src/routes/candidate.js')));
    assert.strictEqual(new Recruiter({ firstName: 'a', slug: 'a', email: 'a@x.com', source: 'li-dm' }).source, 'li-dm');
    assert.strictEqual(new Candidate({ firstName: 'a', slug: 'b', email: 'b@x.com' }).source, null);
  });

  await t('staff overview adds visits and signups per tag, with totals', async () => {
    SourceVisit.find = async () => [{ src: 'li-dm', target: 'demo', count: 12 }, { src: 'li-dm', target: 'demo', count: 5 }, { src: 'li-post', target: 'site', count: 40 }, { src: 'li-post', target: 'demo', count: 9 }];
    Recruiter.aggregate = async () => [{ _id: 'li-dm', n: 2 }];
    Candidate.aggregate = async () => [{ _id: 'li-post', n: 3 }, { _id: 'old-tag', n: 1 }];
    const o = await sources.overview({ days: 30, now: new Date('2026-12-01T12:00:00Z') });
    const byTag = Object.fromEntries(o.rows.map((r) => [r.src, r]));
    assert.deepStrictEqual(byTag['li-dm'], { src: 'li-dm', demo: 17, site: 0, recruiters: 2, candidates: 0 });
    assert.deepStrictEqual(byTag['li-post'], { src: 'li-post', demo: 9, site: 40, recruiters: 0, candidates: 3 });
    assert.strictEqual(byTag['old-tag'].candidates, 1);
    assert.deepStrictEqual(o.total, { demo: 26, site: 40, recruiters: 2, candidates: 4 });
    assert.strictEqual(o.rows[0].src, 'li-post');
  });

  await t('staff page renders, is routed, and is linked from the dashboard', async () => {
    const html = await ejs.renderFile(path.join(root, 'views/internal-sources.ejs'), { data: { days: 30, rows: [{ src: 'li-dm', demo: 1, site: 2, recruiters: 3, candidates: 4 }], total: { demo: 1, site: 2, recruiters: 3, candidates: 4 } } });
    assert(/li-dm/.test(html) && /How to tag a link/.test(html));
    const empty = await ejs.renderFile(path.join(root, 'views/internal-sources.ejs'), { data: { days: 30, rows: [], total: {} } });
    assert(/Nothing yet/.test(empty));
    assert(/router\.get\('\/sources'/.test(read('src/routes/internal.js')));
    assert(/href="\/sources"/.test(read('views/internal-dashboard.ejs')));
  });

  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
