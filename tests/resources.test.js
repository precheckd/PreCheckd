// Resource center: the guides, the hub, the footer link and the sitemap entries.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const layouts = require('express-ejs-layouts');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

process.env.PUBLIC_BASE_URL = 'https://precheckd.com';
const resources = require('../src/content/resources');
const Recruiter = require('../src/models/Recruiter');
const seo = require('../src/services/seo');
Recruiter.find = () => ({ select: () => ({ lean: async () => [] }) });

const get = (port, p) => new Promise((resolve, reject) => {
  http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
});

function appWithRoutes() {
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(root, 'views')); app.use(layouts); app.set('layout', 'layouts/main');
  app.locals.stripePublishableKey = 'pk'; app.locals.gaMeasurementId = null; app.locals.endReasons = { candidate: [], recruiter: [] }; app.locals.SKILL_PASS_RATIO = 0.8;
  app.use((req, res, next) => { res.locals.isAdminHost = false; res.locals.currentPath = req.path; res.locals.loggedInRecruiterSlug = null; res.locals.loggedInCandidateSlug = null; next(); });
  app.use('/', require('../src/routes/index'));
  app.use((req, res) => res.status(404).send('Not found'));
  return app;
}

(async () => {
  await t('every guide is complete and unique', () => {
    assert(resources.GUIDES.length >= 4);
    const slugs = new Set(); const titles = new Set(); const descs = new Set();
    resources.GUIDES.forEach((g) => {
      assert(/^[a-z0-9-]+$/.test(g.slug), g.slug);
      ['title', 'description', 'summary', 'intro', 'updated'].forEach((k) => assert(g[k] && String(g[k]).trim(), g.slug + ' missing ' + k));
      assert(g.sections.length >= 3, g.slug + ' needs sections');
      g.sections.forEach((s) => { assert(s.h, g.slug + ' section heading'); assert((s.p && s.p.length) || (s.ul && s.ul.length), g.slug + ' empty section ' + s.h); });
      assert(g.description.length <= 200, g.slug + ' description too long for a search result');
      assert(/^\d{4}-\d{2}-\d{2}$/.test(g.updated));
      slugs.add(g.slug); titles.add(g.title); descs.add(g.description);
    });
    assert.strictEqual(slugs.size, resources.GUIDES.length); assert.strictEqual(titles.size, resources.GUIDES.length); assert.strictEqual(descs.size, resources.GUIDES.length);
  });

  await t('related guides all exist and never point at themselves', () => {
    resources.GUIDES.forEach((g) => (g.related || []).forEach((r) => { assert(resources.bySlug(r), g.slug + ' -> ' + r); assert.notStrictEqual(r, g.slug); }));
  });

  await t('links inside the guides go to real pages, and outside links are safe', () => {
    const known = ['/is-this-recruiter-real', '/fraud', '/candidate-signup', '/recruiter-search', '/skills-explained', '/resources'];
    const text = JSON.stringify(resources.GUIDES);
    (text.match(/href=\\"[^"\\]+\\"/g) || []).forEach((h) => {
      const url = h.replace(/href=\\"/, '').replace(/\\"$/, '');
      if (url.startsWith('http')) assert(url.startsWith('https://'), url);
      else assert(known.includes(url), 'unknown internal link ' + url);
    });
    (text.match(/<a [^>]*href=\\"https?:[^>]*>/g) || []).forEach((a) => assert(/rel=\\"noopener noreferrer\\"/.test(a), 'external link needs rel: ' + a));
  });

  await t('no invented statistics', () => {
    const text = resources.GUIDES.map((g) => JSON.stringify(g)).join(' ');
    assert(!/\d+(\.\d+)?\s?%/.test(text), 'percentages need a source');
    assert(!/\$\s?\d/.test(text), 'dollar figures need a source');
  });

  const server = appWithRoutes().listen(0); const port = server.address().port;
  try {
    await t('hub lists every guide and the extra pages', async () => {
      const r = await get(port, '/resources');
      assert.strictEqual(r.status, 200);
      resources.GUIDES.forEach((g) => { assert(r.body.includes('href="/resources/' + g.slug + '"'), g.slug); });
      resources.EXTRAS.forEach((x) => assert(r.body.includes('href="' + x.href + '"'), x.href));
      assert(/<title>Resource Center: Guides for Job Seekers \| PreCheckd<\/title>/.test(r.body));
      assert(r.body.includes('rel="canonical" href="https://precheckd.com/resources"'));
      assert(!/name="robots"/.test(r.body));
    });

    await t('each guide renders with its own title, description, canonical and article data', async () => {
      for (const g of resources.GUIDES) {
        const r = await get(port, '/resources/' + g.slug);
        assert.strictEqual(r.status, 200, g.slug);
        assert(r.body.includes('<title>' + g.title.replace(/&/g, '&amp;') + ' | PreCheckd</title>'), g.slug + ' title');
        assert(r.body.includes('rel="canonical" href="https://precheckd.com/resources/' + g.slug + '"'), g.slug + ' canonical');
        assert(r.body.includes('<h1 class="page-title">'), g.slug + ' h1');
        const ld = r.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
        assert(ld, g.slug + ' json-ld');
        const data = JSON.parse(ld[1]);
        assert.strictEqual(data['@type'], 'Article'); assert.strictEqual(data.headline, g.title); assert.strictEqual(data.dateModified, g.updated);
        assert(!/name="robots"/.test(r.body));
        assert(!/\*\*/.test(r.body.replace(/<script[\s\S]*?<\/script>/g, '')), g.slug + ' stray bold markers');
      }
    });

    await t('an unknown guide is a plain 404', async () => {
      assert.strictEqual((await get(port, '/resources/not-a-real-guide')).status, 404);
    });

    await t('footer: Resource center link, Report a scam in Legal, checker only in the hub', async () => {
      const r = await get(port, '/resources');
      assert(/<a href="\/resources">Resource center<\/a>/.test(r.body));
      const legal = r.body.split('<h3>Legal</h3>')[1].split('</ul>')[0];
      assert(/\/terms/.test(legal) && /\/privacy/.test(legal) && !/skills-explained/.test(legal));
      assert(/href="\/fraud">Report a scam/.test(legal), 'Report a scam sits in Legal');
      const links = r.body.split('<h3>Links</h3>')[1].split('</ul>')[0];
      assert(!/\/fraud/.test(links) && !/is-this-recruiter-real/.test(links), 'checker lives in the Resource center, not the Links column');
    });
  } finally { server.close(); }

  await t('sitemap lists the hub and every guide', async () => {
    const x = await seo.sitemapXml();
    assert(x.includes('<loc>https://precheckd.com/resources</loc>'));
    resources.GUIDES.forEach((g) => assert(x.includes('<loc>https://precheckd.com/resources/' + g.slug + '</loc>'), g.slug));
  });

  await t('robots.txt does not block the Resource center', () => assert(!/Disallow: \/resources/.test(seo.robotsTxt())));

  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
