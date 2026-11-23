// The school scraper: page parsing, robots.txt, what counts as "confirmed", and the resumable run.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sc = require('../src/services/schoolScrape');
const { run } = require('../src/services/schoolScrapeRun');
const csv = require('../src/utils/csv');
const imp = require('../src/services/schoolImport');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

const HOME = `<html><body><a href="/about">About</a><a href="/registrar/">Office of the Registrar</a><a href="https://other.com/registrar">Elsewhere</a>
  <a href="/admissions">Admissions</a><a href="/records/verification.pdf">PDF</a><a href="/students/verify-enrollment">Enrollment verification</a><script>var x="registrar@evil.com";</script></body></html>`;
const REG = `<html><body><h1>Registrar</h1><p>Degree verifications: <a href="mailto:Verify@State.edu?subject=hi">verify@state.edu</a></p><p>Call <a href="tel:+1-555-010-0199">555-010-0199</a></p><style>.x{}</style></body></html>`;

(async () => {
  await t('page helpers strip scripts and find links, emails and phones', () => {
    assert(!sc.htmlToText(HOME).includes('evil'));
    assert(sc.htmlToText(REG).includes('Degree verifications'));
    assert.deepStrictEqual(sc.mailtos(REG), ['verify@state.edu']);
    assert.deepStrictEqual(sc.tels(REG), ['+1-555-010-0199']);
  });
  await t('registrar and verification links on the school site are chosen; other sites and files are not', () => {
    const pages = sc.pickPages(HOME, 'https://www.state.edu');
    assert(pages.includes('https://www.state.edu/registrar/') && pages.includes('https://www.state.edu/students/verify-enrollment'));
    assert(!pages.some((p) => p.includes('other.com') || p.endsWith('.pdf')));
    assert(pages.length <= 4);
  });
  await t('robots.txt: our group or the wildcard, longest rule wins', () => {
    const r = sc.parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: badbot\nDisallow: /');
    assert(r.allowed('/registrar')); assert(!r.allowed('/private/x')); assert(r.allowed('/private/ok/page'));
    assert(!sc.parseRobots('User-agent: PreCheckdSchoolDirectoryBot\nDisallow: /').allowed('/registrar'));
    assert(sc.parseRobots('').allowed('/anything'));
  });
  await t('model answers are parsed defensively', () => {
    assert.strictEqual(sc.parseModelJson('Sure! {"email":"A@B.edu","phone":null,"clearinghouseOnly":false,"notes":"ok"} done').email, 'a@b.edu');
    assert.strictEqual(sc.parseModelJson('no json here'), null); assert.strictEqual(sc.parseModelJson('{bad'), null);
  });
  const school = { name: 'State University', ipedsId: '111', website: 'https://www.state.edu/' };
  const pages = [{ url: 'https://www.state.edu/registrar/', mailtos: ['verify@state.edu'], tels: [], text: 'Contact verify@state.edu' }];
  await t('confirmed only if the email is on a fetched page and on the school domain', () => {
    const ok = sc.decide(school, { email: 'verify@state.edu', phone: '555', clearinghouseOnly: false, notes: '' }, pages);
    assert.strictEqual(ok.registrarEmail, 'verify@state.edu'); assert.strictEqual(ok.sourceUrl, 'https://www.state.edu/registrar/'); assert.strictEqual(ok.registrarPhone, '555');
    assert.strictEqual(sc.decide(school, { email: 'made.up@state.edu' }, pages).registrarEmail, ''); // not on any page: invented
    assert.strictEqual(sc.decide(school, { email: 'verify@gmail.com' }, [{ url: 'u', mailtos: ['verify@gmail.com'], tels: [], text: '' }]).registrarEmail, ''); // not the school's domain
    assert.strictEqual(sc.decide(school, { email: 'x@registrar.state.edu' }, [{ url: 'u', mailtos: ['x@registrar.state.edu'], tels: [], text: '' }]).registrarEmail, 'x@registrar.state.edu'); // subdomain is fine
  });
  await t('a Clearinghouse-only school is flagged and gets no email', () => {
    const r = sc.decide(school, { email: 'verify@state.edu', clearinghouseOnly: true, notes: '' }, pages);
    assert.strictEqual(r.clearinghouseOnly, 'yes'); assert.strictEqual(r.registrarEmail, '');
  });

  const web = { 'https://www.state.edu/robots.txt': 'User-agent: *\nDisallow: /secret', 'https://www.state.edu/': HOME, 'https://www.state.edu/registrar/': REG };
  const mkDeps = (answer) => ({
    fetchPage: async (u) => (web[u] ? { ok: true, html: web[u], url: u } : { ok: false }),
    robotsFor: async (o) => sc.parseRobots(web[o + '/robots.txt'] || ''),
    callModel: async (sys, user) => { mkDeps.last = user; return { text: JSON.stringify(answer), usage: { input_tokens: 1000, output_tokens: 100 } }; },
  });
  await t('one school end to end: pages fetched, model asked, row confirmed, tokens counted', async () => {
    const r = await sc.scrapeSchool(school, mkDeps({ email: 'verify@state.edu', phone: '555-010-0199', clearinghouseOnly: false, notes: '' }));
    assert.strictEqual(r.row.registrarEmail, 'verify@state.edu'); assert.strictEqual(r.tally.inTokens, 1000);
    assert(mkDeps.last.includes('Emails on page: verify@state.edu'));
  });
  await t('an unreachable site or one with no registrar page becomes a research row', async () => {
    const r = await sc.scrapeSchool({ name: 'Gone U', ipedsId: '9', website: 'gone.edu' }, mkDeps({}));
    assert.strictEqual(r.row.registrarEmail, ''); assert(r.error);
  });
  await t('robots.txt disallow is respected', async () => {
    web['https://www.state.edu/robots.txt'] = 'User-agent: *\nDisallow: /';
    const r = await sc.scrapeSchool(school, mkDeps({ email: 'verify@state.edu' }));
    assert(r.error); assert.strictEqual(r.row.registrarEmail, '');
    web['https://www.state.edu/robots.txt'] = 'User-agent: *\nDisallow: /secret';
  });

  const tmp = path.join(os.tmpdir(), 'scrape-test-' + Date.now()); fs.mkdirSync(tmp);
  const out = path.join(tmp, 'schools.csv');
  const three = [school, { name: 'Gone U', ipedsId: '9', website: 'gone.edu' }, { name: 'Second U', ipedsId: '222', website: 'second.edu' }];
  await t('a run writes a CSV, and running again does only the schools not yet done', async () => {
    let calls = 0; const deps = mkDeps({ email: 'verify@state.edu', clearinghouseOnly: false });
    const counting = { ...deps, callModel: async (...a) => { calls += 1; return deps.callModel(...a); } };
    await run({ schools: three.slice(0, 2), out, concurrency: 2, deps: counting }).done;
    const first = csv.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(first.length, 2); assert.strictEqual(first[0].registrarEmail, 'verify@state.edu'); assert.strictEqual(first[1].registrarEmail, '');
    const callsBefore = calls;
    await run({ schools: three, out, concurrency: 2, deps: counting }).done;
    assert.strictEqual(csv.parse(fs.readFileSync(out, 'utf8')).length, 3); assert.strictEqual(calls, callsBefore); // the other two were already done; Second U has no site so no model call
  });
  await t('a model crash is retried on the next run, and the spending limit stops a run', async () => {
    const out2 = path.join(tmp, 'b.csv');
    const bad = { ...mkDeps({}), callModel: async () => { throw new Error('model busy'); } };
    await run({ schools: [school], out: out2, deps: bad }).done;
    assert(!fs.existsSync(out2 + '.progress.jsonl') || fs.readFileSync(out2 + '.progress.jsonl', 'utf8').trim() === ''); // not saved as progress
    const out3 = path.join(tmp, 'c.csv');
    const res = await run({ schools: [school, { ...school, ipedsId: '2', name: 'B' }, { ...school, ipedsId: '3', name: 'C' }], out: out3, concurrency: 1, maxUsd: 0.0015, priceIn: 1, priceOut: 5, deps: mkDeps({ email: 'verify@state.edu' }) }).done;
    assert(res.rows.length < 3); // 1000 in + 100 out is about $0.0015: it stopped after the first
  });
  await t('csv round trip keeps commas and quotes', () => {
    const rows = [{ name: 'Smith, "Big" College', ipedsId: '1' }];
    assert.deepStrictEqual(csv.parse(csv.stringify(rows, ['name', 'ipedsId'])), rows);
  });
  await t('the importer never guesses an address for a Clearinghouse-only school, and keeps notes', async () => {
    const resolver = { resolveMx: async () => [{ exchange: 'mx', priority: 1 }] };
    const r = await imp.classify({ name: 'CH U', website: 'ch.edu', clearinghouseOnly: 'yes', notes: 'uses Clearinghouse' }, resolver);
    assert.strictEqual(r.emailStatus, 'needs_research'); assert.strictEqual(r.registrarEmail, ''); assert.strictEqual(r.notes, 'uses Clearinghouse');
    assert.strictEqual((await imp.classify({ name: 'X', website: 'x.edu' }, resolver)).emailStatus, 'guessed');
  });
  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
