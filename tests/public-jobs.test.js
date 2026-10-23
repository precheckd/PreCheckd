// Run: node tests/public-jobs.test.js
// Public job pages: no address leaks, closed state, redirects, previews, job markup, blurred circles.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.SESSION_SECRET = 'test-secret';
process.env.DISABLE_JOB_NOTICES = 'true';
const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const JobPosting = require('../src/models/JobPosting');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const pub = require('../src/services/publicJob');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

const day = 86400000;
function make(over = {}) {
  return new JobPosting({
    recruiterId: '507f1f77bcf86cd799439011', status: 'open', source: 'precheckd', nickname: 'SECRET-LABEL',
    titleId: 'cloud-engineer', title: 'Cloud Engineer', skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }, { key: 'cloud', label: 'Cloud', minLevel: null }],
    seniorityLabel: 'Mid-level', hiringCompany: 'Acme <Corp>', authorizedToRecruit: true, employmentType: 'full_time', openings: 2,
    arrangement: 'onsite', address: '1 Private Lane, Boston, MA 02110', areaRule: { point: [-71.0589, 42.3601] },
    areaLabel: 'within 25 miles of Boston, MA', displayCity: 'Boston', displayState: 'MA',
    relocation: false, travel: 'none', shift: 'daytime', basePayType: 'salary', baseMin: 100000, baseMax: 120000, payBasis: ['skill_level'],
    benefits: ['health'], goodFaithAt: new Date(), requirementsAttestedAt: new Date(), education: 'bachelor',
    certGroups: [{ certs: [{ catalogId: 'comptia-security-plus', label: 'CompTIA Security+' }] }],
    closeDate: new Date(Date.now() + 10 * day), startDate: new Date(Date.now() + 30 * day), startFirm: true,
    summary: 'Run our cloud platform with a small friendly team that ships every week.',
    responsibilities: ['Operate infrastructure', 'Improve pipelines', 'Respond to incidents'],
    createdAt: new Date(), ...over,
  });
}
assert.strictEqual(make().validateSync(), undefined);

const postings = [];
JobPosting.find = (filter) => ({ sort: async () => postings.filter((p) => !filter || !filter.status || p.status === filter.status) });
JobPosting.findById = async (id) => postings.find((p) => String(p._id) === String(id)) || null;
Recruiter.findById = async () => ({ firstName: 'Pat', lastName: 'Lee', slug: 'pat-lee', isActive: true, isSuspended: false });
const SkillResult = require('../src/models/SkillResult');
require('../src/models/JobApplication').findOne = async () => null;
require('../src/models/JobApplication').find = async () => [];
SkillResult.find = () => ({ select: async () => [] });
require('../src/services/skills').currentSkills = async () => [];
let candidate = null;
Candidate.findById = async () => candidate;

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.locals.stripePublishableKey = 'pk_test';
app.use(expressLayouts);
app.set('layout', 'layouts/main');
let session = {};
app.use((req, res, next) => { req.session = session; res.locals.isAdminHost = false; next(); });
app.use('/jobs', require('../src/routes/jobs'));
app.use((req, res) => res.status(404).send('nf'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('err'); });

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p, { redirect: 'manual' });

  const open = make(); const closedByStatus = make({ status: 'closed', title: 'Old Role' });
  const pastDue = make({ closeDate: new Date(Date.now() - day), title: 'Late Role' });
  const removed = make({ status: 'removed', title: 'Removed Role' });
  const remote = make({ arrangement: 'remote', address: '', areaRule: undefined, displayCity: '', displayState: '', areaLabel: '', title: 'Remote Role', titleId: 'devops-engineer' });
  postings.push(open, closedByStatus, pastDue, removed, remote);

  await t('the public page shows the job but never the street address or internal label', async () => {
    const res = await get(pub.pathOf(open));
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(html.includes('Cloud Engineer') && html.includes('Boston, MA') && html.includes('$100,000 to $120,000 a year'));
    assert.ok(html.includes('Linux: at least Intermediate') && html.includes('CompTIA Security+'));
    assert.ok(!html.includes('Private Lane') && !html.includes('02110') && !html.includes('SECRET-LABEL'));
    assert.ok(!html.includes('-71.0589') && !html.includes('42.3601'));
  });

  await t('company and text are escaped', async () => {
    const html = await (await get(pub.pathOf(open))).text();
    assert.ok(html.includes('Acme &lt;Corp&gt;') && !html.includes('Acme <Corp>'));
  });

  await t('link previews carry title, company, place and pay, with no address', async () => {
    const html = await (await get(pub.pathOf(open))).text();
    const og = html.match(/<meta property="og:title" content="([^"]*)"/)[1];
    const desc = html.match(/<meta property="og:description" content="([^"]*)"/)[1];
    assert.ok(og.includes('Cloud Engineer at Acme') && og.includes('Boston, MA'));
    assert.ok(desc.includes('$100,000 to $120,000 a year') && desc.includes('Linux'));
    assert.ok(!desc.includes('Private') && html.includes(`<link rel="canonical" href="https://precheckd.com${pub.pathOf(open)}">`));
    assert.ok(html.includes('<meta name="twitter:card"') && !html.includes('noindex'));
  });

  await t('search-engine job markup is present, parses, and has no street address', async () => {
    const html = await (await get(pub.pathOf(open))).text();
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(m);
    const ld = JSON.parse(m[1]);
    assert.strictEqual(ld['@type'], 'JobPosting');
    assert.strictEqual(ld.title, 'Cloud Engineer');
    assert.strictEqual(ld.employmentType, 'FULL_TIME');
    assert.strictEqual(ld.jobLocation.address.addressLocality, 'Boston');
    assert.strictEqual(ld.jobLocation.address.streetAddress, undefined);
    assert.strictEqual(ld.baseSalary.value.unitText, 'YEAR');
    assert.ok(ld.validThrough && ld.datePosted && !JSON.stringify(ld).includes('Private'));
  });

  await t('a remote job is marked as telecommute with no place', async () => {
    const ld = pub.jobPostingJsonLd(pub.publicShape(remote));
    assert.strictEqual(ld.jobLocationType, 'TELECOMMUTE');
    assert.strictEqual(ld.jobLocation, undefined);
  });

  await t('markup cannot break out of the script tag', async () => {
    const s = pub.jsonLdScript({ a: '</script><script>alert(1)</script>' });
    assert.ok(!s.slice(40, -9).includes('</script>'));
  });

  await t('a wrong or missing title in the link redirects to the proper one', async () => {
    const r = await get(`/jobs/${open._id}`);
    assert.strictEqual(r.status, 301);
    assert.strictEqual(r.headers.get('location'), pub.pathOf(open));
    assert.strictEqual((await get(`/jobs/${open._id}/wrong-words`)).status, 301);
  });

  await t('a closed posting says so (not a 404) and is kept out of search engines', async () => {
    for (const p of [closedByStatus, pastDue]) {
      const res = await get(pub.pathOf(p));
      const html = await res.text();
      assert.strictEqual(res.status, 200);
      assert.ok(html.includes('This position is closed.') && html.includes('<meta name="robots" content="noindex">'));
      assert.ok(!html.includes('application/ld+json') && !html.includes('Sign up to apply'));
    }
  });

  await t('removed postings and made-up ids are 404', async () => {
    assert.strictEqual((await get(pub.pathOf(removed))).status, 404);
    assert.strictEqual((await get('/jobs/not-an-id')).status, 404);
    assert.strictEqual((await get('/jobs/507f1f77bcf86cd7994399ff/x')).status, 404);
  });

  await t('the list shows only open jobs, searches, and puts only blurred circles on the map', async () => {
    const html = await (await get('/jobs')).text();
    assert.ok(html.includes('Cloud Engineer') && html.includes('Remote Role'));
    assert.ok(!html.includes('Old Role') && !html.includes('Late Role') && !html.includes('Removed Role'));
    assert.ok(!html.includes('Private Lane') && !html.includes('-71.0589') && !html.includes('42.3601') && !html.includes('SECRET-LABEL'));
    const pins = JSON.parse(html.match(/id="jl-pins">([\s\S]*?)<\/script>/)[1]);
    assert.strictEqual(pins.length, 1); // the remote job has no place to pin
    const bySearch = await (await get('/jobs?q=remote+role')).text();
    assert.ok(bySearch.includes('Remote Role') && !bySearch.includes('<div class="jl-title">Cloud Engineer'));
    const byArr = await (await get('/jobs?arrangement=onsite')).text();
    assert.ok(byArr.includes('Cloud Engineer') && !byArr.includes('Remote Role'));
    assert.ok((await (await get('/jobs?q=zzzz')).text()).includes('No open jobs match'));
  });

  await t('the blurred circle holds the real spot but is not centred on it, and is stable', async () => {
    const [lng, lat] = [-71.0589, 42.3601];
    const c = pub.blurredCircle([lng, lat], 'abc', 's1');
    const miles = Math.hypot((c.lat - lat) * 69, (c.lng - lng) * 69 * Math.cos(lat * Math.PI / 180));
    assert.ok(miles > 0.5 && miles < c.radiusMiles - 0.1, `offset ${miles}`);
    assert.deepStrictEqual(c, pub.blurredCircle([lng, lat], 'abc', 's1'));
    assert.notDeepStrictEqual(c, pub.blurredCircle([lng, lat], 'abd', 's1'));
    assert.notDeepStrictEqual(c, pub.blurredCircle([lng, lat], 'abc', 's2'));
    assert.strictEqual(pub.blurredCircle(undefined, 'x'), null);
  });

  await t('a logged-in recruiter cannot apply; the owner gets a manage link', async () => {
    session = { recruiterId: '507f1f77bcf86cd799439022' };
    let html = await (await get(pub.pathOf(open))).text();
    assert.ok(html.includes('Recruiters cannot apply to jobs.') && !html.includes('Manage this posting'));
    session = { recruiterId: '507f1f77bcf86cd799439011' };
    html = await (await get(pub.pathOf(open))).text();
    assert.ok(html.includes('This is your posting.') && html.includes('Manage this posting'));
  });

  await t('a logged-in candidate sees what is missing and how to fix it', async () => {
    candidate = new Candidate({ firstName: 'Cam', lastName: 'Doe', slug: 'cam-doe', email: 'c@example.com', phone: '+15555550100' });
    session = { candidateId: String(candidate._id) };
    const html = await (await get(pub.pathOf(open))).text();
    assert.ok(html.includes('You do not meet every requirement yet'));
    assert.ok(html.includes('/candidate/cam-doe/'));
    assert.ok(!html.includes('Sign up to apply'));
    session = {};
    candidate = null;
  });

  await t('the job list: visitors see everything, candidates see what they qualify for first', async () => {
    const entry = make({ arrangement: 'remote', address: '', areaRule: undefined, displayCity: '', displayState: '', areaLabel: '', title: 'Entry Remote Role', titleId: 'help-desk-technician', education: undefined, certGroups: [], skills: [{ key: 'linux', label: 'Linux', minLevel: null }] });
    postings.push(entry);
    let html = await (await get('/jobs')).text();
    assert.ok(html.includes('Entry Remote Role') && html.includes('Remote Role') && html.includes('Cloud Engineer') && !html.includes('Jobs for you'));
    candidate = new Candidate({ firstName: 'Cam', lastName: 'Doe', slug: 'cam-doe', email: 'c@example.com', phone: '+15555550100',
      emailVerifiedAt: new Date(), isPhoneVerified: true, isIdentityVerified: true, shifts: ['daytime'] });
    session = { candidateId: String(candidate._id) };
    html = await (await get('/jobs')).text();
    assert.ok(html.includes('Jobs for you (1)') && html.includes('All open jobs (') && html.includes('You qualify'));
    assert.ok(html.includes('Entry Remote Role') && !html.includes('Cloud Engineer</div>'));
    html = await (await get('/jobs?view=all')).text();
    if (process.env.DUMP_LIST) require('fs').writeFileSync(process.env.DUMP_LIST, html);
    assert.ok(html.includes('To apply:') && html.includes('Needs Intermediate Linux') && html.includes('Cloud Engineer'));
    assert.ok(html.includes('href="/candidate/cam-doe/skills"') && html.includes('jl-mapbtn'));
    assert.ok(html.indexOf('Entry Remote Role') < html.indexOf('Cloud Engineer'));
    postings.splice(postings.indexOf(entry), 1);
    html = await (await get('/jobs')).text();
    assert.ok(html.includes('None of the open jobs match your profile yet') && html.includes('To apply:'));
    session = {}; candidate = null;
  });

  await t('the sitemap lists open jobs only', async () => {
    const res = await get('/jobs/sitemap.xml');
    const xml = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(xml.includes(pub.pathOf(open)) && xml.includes(pub.pathOf(remote)) && !xml.includes(pub.pathOf(closedByStatus)) && !xml.includes(pub.pathOf(pastDue)));
  });

  await t('a visitor who is not logged in is asked to sign up or log in', async () => {
    const html = await (await get(pub.pathOf(open))).text();
    assert.ok(html.includes('Sign up to apply') && html.includes('href="/login"'));
  });

  server.close();
  console.log(`\n${n} tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
