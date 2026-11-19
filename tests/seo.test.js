// SEO basics: robots.txt, sitemap, recruiter page metadata, and the public "Is this recruiter real?" check.
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

process.env.PUBLIC_BASE_URL = 'https://precheckd.com';
const Recruiter = require('../src/models/Recruiter');
const seo = require('../src/services/seo');
const publicCheck = require('../src/services/publicCheck');

// A tiny stand-in for the paid domain lookup, so nothing here touches the network.
const axios = require('axios');
let whoisCalls = 0;
let whoisCreated = '2015-03-01T00:00:00Z';
axios.get = async () => { whoisCalls++; return { data: { WhoisRecord: { createdDate: whoisCreated } } }; };

let recruiters = [];
Recruiter.find = () => ({ select: () => ({ lean: async () => recruiters }) });
let account = null;
Recruiter.findOne = () => ({ select: async () => account });

const request = (port, method, p, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({ port, method, path: p, headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers) }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});

(async () => {
  await t('robots.txt allows public pages, blocks private areas and lists both sitemaps', () => {
    const r = seo.robotsTxt();
    assert(/User-agent: \*/.test(r) && /Allow: \//.test(r));
    ['/api/', '/internal', '/recruiter-dashboard', '/candidate-dashboard', '/safety', '/candidate/'].forEach((p) => assert(r.includes('Disallow: ' + p), p));
    assert(!/Disallow: \/candidate-landing/.test(r) && !/Disallow: \/recruiter-landing/.test(r) && !/Disallow: \/is-this-recruiter-real/.test(r));
    assert(r.includes('Sitemap: https://precheckd.com/sitemap.xml') && r.includes('Sitemap: https://precheckd.com/jobs/sitemap.xml'));
  });
  await t('the staff site is blocked entirely', () => assert.strictEqual(seo.robotsTxt({ adminHost: true }), 'User-agent: *\nDisallow: /\n'));

  await t('sitemap lists public pages and only verified recruiters', async () => {
    recruiters = [{ slug: 'jane-doe' }, { slug: 'a&b' }];
    const x = await seo.sitemapXml();
    assert(x.includes('<loc>https://precheckd.com/</loc>') && x.includes('https://precheckd.com/is-this-recruiter-real') && x.includes('https://precheckd.com/founder'));
    assert(x.includes('https://precheckd.com/recruiter/jane-doe') && x.includes('https://precheckd.com/recruiter/a%26b'));
    assert(!x.includes('/candidate-dashboard') && !x.includes('/login'));
    let q = null;
    Recruiter.find = (query) => { q = query; return { select: () => ({ lean: async () => [] }) }; };
    await seo.sitemapXml();
    assert.strictEqual(q.isActive, true); assert.strictEqual(q.isPhoneVerified, true); assert.strictEqual(q.isIdentityVerified, true);
    assert.deepStrictEqual(q.accountTier, { $ne: 'unverified_claim' });
    Recruiter.find = () => ({ select: () => ({ lean: async () => recruiters }) });
  });
  await t('sitemap still builds if the database fails', async () => {
    Recruiter.find = () => { throw new Error('db down'); };
    const x = await seo.sitemapXml();
    assert(x.includes('https://precheckd.com/founder'));
    Recruiter.find = () => ({ select: () => ({ lean: async () => recruiters }) });
  });

  await t('recruiter page: verified gets a real title and description, others are noindex', () => {
    const ok = { firstName: 'Jane', lastName: 'Doe', company: 'Acme', slug: 'jane-doe', isActive: true, isPhoneVerified: true, isIdentityVerified: true, accountTier: 'standard' };
    const m = seo.recruiterMeta(ok);
    assert(/Jane Doe - Verified Recruiter at Acme/.test(m.pageTitle) && /verified recruiter at Acme/.test(m.metaDescription));
    assert.strictEqual(m.canonicalUrl, 'https://precheckd.com/recruiter/jane-doe'); assert.strictEqual(m.robotsMeta, '');
    assert.strictEqual(seo.recruiterMeta(Object.assign({}, ok, { isIdentityVerified: false })).robotsMeta, 'noindex');
    assert.strictEqual(seo.recruiterMeta(Object.assign({}, ok, { accountTier: 'unverified_claim' })).robotsMeta, 'noindex');
    assert.strictEqual(seo.recruiterMeta(Object.assign({}, ok, { isSuspended: true })).robotsMeta, 'noindex');
    assert(!/verified recruiter/i.test(seo.recruiterMeta(Object.assign({}, ok, { isPhoneVerified: false })).metaDescription));
    assert(!/ at /.test(seo.recruiterMeta(Object.assign({}, ok, { company: 'Not provided' })).pageTitle));
  });
  await t('recruiter route passes the metadata to the page', () => assert(/recruiterMeta\(recruiter\)/.test(read('src/routes/recruiter-profile.js'))));

  await t('main pages each have their own description', () => {
    const idx = read('src/routes/index.js'); const app = read('src/app.js');
    const found = idx.match(/metaDescription: '[^']+'/g) || [];
    assert(found.length >= 8, 'found ' + found.length);
    assert.strictEqual(new Set(found).size, found.length, 'descriptions must be different');
    assert(/pageTitle: 'PreCheckd - Founding Recruiter Signup', metaDescription/.test(app));
    assert(/pageTitle: 'PreCheckd - Members Login', robotsMeta: 'noindex'/.test(idx));
  });

  await t('email parsing', () => {
    assert.deepStrictEqual(publicCheck.parseEmail('  Jane@Acme.COM '), { email: 'jane@acme.com', domain: 'acme.com' });
    ['', null, undefined, 42, 'nope', 'a@b', 'a@@b.com', 'a b@c.com', 'x@-bad.com', 'x@' + 'a'.repeat(70) + '.com', 'x@evil.com/../y', 'a'.repeat(250) + '@x.com'].forEach((b) => assert.strictEqual(publicCheck.parseEmail(b), null, String(b)));
  });

  await t('established domain, verified recruiter', async () => {
    publicCheck.reset(); whoisCalls = 0;
    account = { firstName: 'Jane', lastName: 'Doe', company: 'Acme', slug: 'jane-doe', isActive: true, isPhoneVerified: true, isIdentityVerified: true, accountTier: 'standard' };
    const r = await publicCheck.run('jane@acme.com', 'acme.com');
    assert.strictEqual(r.age.status, 'established'); assert.strictEqual(r.age.year, 2015);
    assert.deepStrictEqual(r.verified, { name: 'Jane Doe', company: 'Acme', profileUrl: '/recruiter/jane-doe' });
    assert(!('contactCount' in r) && !('fraud' in r));
  });
  await t('unverified account is never shown as verified', async () => {
    account = { firstName: 'X', lastName: 'Y', slug: 'x', isActive: true, isPhoneVerified: true, isIdentityVerified: false, accountTier: 'standard' };
    assert.strictEqual((await publicCheck.run('x@acme.com', 'acme.com')).verified, null);
    account = null;
    assert.strictEqual((await publicCheck.run('x@acme.com', 'acme.com')).verified, null);
  });
  await t('new domain is flagged', async () => {
    publicCheck.reset(); whoisCreated = new Date(Date.now() - 5 * 86400000).toISOString();
    const r = await publicCheck.run('a@fresh-scam.com', 'fresh-scam.com');
    assert.strictEqual(r.age.status, 'new'); assert(r.age.days >= 4 && r.age.days <= 6);
    whoisCreated = '2015-03-01T00:00:00Z';
  });
  await t('free email providers skip the paid lookup', async () => {
    publicCheck.reset(); whoisCalls = 0;
    const r = await publicCheck.run('x@gmail.com', 'gmail.com');
    assert.strictEqual(r.freeProvider, true); assert.strictEqual(r.age, null); assert.strictEqual(whoisCalls, 0);
  });
  await t('the same domain is only looked up once a day', async () => {
    publicCheck.reset(); whoisCalls = 0;
    await publicCheck.run('a@same.com', 'same.com'); await publicCheck.run('b@same.com', 'same.com');
    assert.strictEqual(whoisCalls, 1);
  });
  await t('a failed lookup says unknown and is not remembered', async () => {
    publicCheck.reset(); whoisCalls = 0;
    axios.get = async () => { whoisCalls++; throw new Error('timeout'); };
    assert.strictEqual((await publicCheck.run('a@down.com', 'down.com')).age.status, 'unknown');
    await publicCheck.run('a@down.com', 'down.com');
    assert.strictEqual(whoisCalls, 2);
    axios.get = async () => { whoisCalls++; return { data: { WhoisRecord: { createdDate: whoisCreated } } }; };
  });

  await t('limits: per visitor per hour, then per day across everyone', () => {
    publicCheck.reset(); delete process.env.PUBLIC_CHECK_PER_HOUR; delete process.env.PUBLIC_CHECK_DAILY_CAP;
    const now = 1_000_000_000_000;
    for (let i = 0; i < 10; i++) assert.strictEqual(publicCheck.allow('1.1.1.1', now + i), null);
    assert.strictEqual(publicCheck.allow('1.1.1.1', now + 100), 'slow-down');
    assert.strictEqual(publicCheck.allow('2.2.2.2', now + 100), null, 'another visitor is unaffected');
    assert.strictEqual(publicCheck.allow('1.1.1.1', now + 61 * 60 * 1000), null, 'frees up after an hour');
    publicCheck.reset(); process.env.PUBLIC_CHECK_DAILY_CAP = '3';
    for (let i = 0; i < 3; i++) assert.strictEqual(publicCheck.allow('ip' + i, now), null);
    assert.strictEqual(publicCheck.allow('new', now + 1000), 'busy');
    assert.strictEqual(publicCheck.allow('new', now + 25 * 3600 * 1000), null, 'resets the next day');
    delete process.env.PUBLIC_CHECK_DAILY_CAP;
  });

  await t('the endpoint answers, refuses bad input, and rate limits', async () => {
    publicCheck.reset(); account = null;
    const app = express(); app.use(express.json());
    app.use('/', require('../src/routes/public-check'));
    const server = app.listen(0); const port = server.address().port;
    try {
      let r = await request(port, 'POST', '/api/public-check', { email: 'nope' });
      assert.strictEqual(r.status, 400);
      r = await request(port, 'POST', '/api/public-check', { email: 'jane@acme.com' });
      assert.strictEqual(r.status, 200);
      const d = JSON.parse(r.body); assert.strictEqual(d.domain, 'acme.com'); assert.strictEqual(d.age.status, 'established');
      for (let i = 0; i < 9; i++) await request(port, 'POST', '/api/public-check', { email: 'j' + i + '@acme.com' });
      r = await request(port, 'POST', '/api/public-check', { email: 'again@acme.com' });
      assert.strictEqual(r.status, 429); assert(/try again/i.test(JSON.parse(r.body).error));
    } finally { server.close(); }
  });

  await t('the page renders, is indexable, and the link is in the footer', async () => {
    const html = await ejs.renderFile(path.join(root, 'views/public-check.ejs'), {});
    assert(/Is this recruiter real\?/.test(html) && /id="public-check-form"/.test(html) && /reportfraud\.ftc\.gov/.test(html) && /public-check\.js/.test(html));
    const page = read('src/routes/public-check.js');
    assert(/canonicalUrl/.test(page) && !/noindex/.test(page));
    assert(/href="\/is-this-recruiter-real"/.test(read('views/layouts/main.ejs')));
    const mounted = read('src/app.js');
    assert(/routes\/public-check/.test(mounted) && /routes\/seo/.test(mounted));
    assert(mounted.indexOf("routes/public-check") > mounted.indexOf('express.json()'), 'must be after body parsing');
  });

  await t('the page script shows the right words and escapes what it shows', () => {
    const js = read('public/js/public-check.js');
    assert(/Verified on PreCheckd/.test(js) && /registered only/.test(js) && /free email address/.test(js));
    assert(/function esc/.test(js) && !/innerHTML = .*d\.email/.test(js));
  });

  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
