// Share your achievement: public view rules, share links, and the two screens that render them.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const Candidate = require('../src/models/Candidate');
const ach = require('../src/services/achievements');

const views = path.join(__dirname, '..', 'views');
const DAY = 86400000;
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const mk = (extra = {}, summary) => new Candidate({
  firstName: 'Kent', lastName: 'Mayer', slug: 'kent-mayer', email: 'k@example.com', phone: '+15555550100',
  skillSummary: summary || [{ key: 'linux', label: 'Linux', level: 'Advanced', grandmaster: false, takenAt: new Date() }],
  sharedSkills: ['linux'], ...extra,
});

(async () => {
  await t('a shared skill gives a public view with first name and last initial only', async () => {
    const v = ach.publicView(mk(), 'linux');
    assert.strictEqual(v.name, 'Kent M.');
    assert.strictEqual(v.level, 'Advanced');
    assert.strictEqual(v.card, 'advanced');
    assert.strictEqual(v.stale, false);
    assert.ok(!JSON.stringify(v).includes('Mayer'));
  });
  await t('not shared, hidden, or below Foundational means no page', async () => {
    assert.strictEqual(ach.publicView(mk({ sharedSkills: [] }), 'linux'), null);
    assert.strictEqual(ach.publicView(mk({ hiddenSkillKeys: ['linux'] }), 'linux'), null);
    assert.strictEqual(ach.publicView(mk({}, [{ key: 'linux', label: 'Linux', level: 'Developing', takenAt: new Date() }]), 'linux'), null);
    assert.strictEqual(ach.publicView(mk(), 'cloud'), null);
  });
  await t('Master and Grandmaster use their own cards and names', async () => {
    const m = ach.publicView(mk({}, [{ key: 'linux', label: 'Linux', level: 'Expert', grandmaster: false, takenAt: new Date() }]), 'linux');
    assert.strictEqual(m.level, 'Master'); assert.strictEqual(m.card, 'master');
    const g = ach.publicView(mk({}, [{ key: 'linux', label: 'Linux', level: 'Expert', grandmaster: true, takenAt: new Date() }]), 'linux');
    assert.strictEqual(g.level, 'Grandmaster'); assert.strictEqual(g.card, 'grandmaster');
  });
  await t('a result over 12 months old is marked as needing a retake', async () => {
    const v = ach.publicView(mk({}, [{ key: 'linux', label: 'Linux', level: 'Advanced', takenAt: new Date(Date.now() - 400 * DAY) }]), 'linux');
    assert.strictEqual(v.stale, true);
  });
  await t('share links carry ?ref=share and open each site\'s own share window', async () => {
    const v = ach.publicView(mk(), 'linux');
    const url = ach.urlFor(mk(), 'linux');
    const l = ach.shareLinks(v, url);
    assert.ok(l.linkedin.startsWith('https://www.linkedin.com/sharing/share-offsite/?url='));
    assert.ok(decodeURIComponent(l.linkedin).includes('?ref=share'));
    assert.ok(l.x.startsWith('https://twitter.com/intent/tweet'));
    assert.ok(l.facebook.startsWith('https://www.facebook.com/sharer/sharer.php'));
    assert.ok(l.email.startsWith('mailto:'));
    assert.ok(l.copy.endsWith('/achievements/kent-mayer/linux?ref=share'));
    const li = ach.linkedinProfileLink(v, url);
    assert.ok(li.includes('startTask=CERTIFICATION_NAME') && li.includes('organizationName=PreCheckd'));
  });
  await t('setShared opts in only for a shareable level and opts out cleanly', async () => {
    const c = mk({ sharedSkills: [] }); c.save = async () => {};
    assert.strictEqual(await ach.setShared(c, 'linux', true), true);
    assert.deepStrictEqual([...c.sharedSkills], ['linux']);
    assert.strictEqual(await ach.setShared(c, 'cloud', true), false);
    await ach.setShared(c, 'linux', false);
    assert.deepStrictEqual([...c.sharedSkills], []);
  });
  await t('the public page and the share box render', async () => {
    const c = mk();
    const v = ach.publicView(c, 'linux');
    const url = ach.urlFor(c, 'linux');
    const page = await ejs.renderFile(path.join(views, 'achievement.ejs'), { v, url });
    assert.ok(page.includes('Kent M. earned Advanced in Linux') && page.includes('/img/share/advanced.png'));
    const on = await ejs.renderFile(path.join(views, 'partials/skill-share.ejs'), { candidate: c, s: { key: 'linux', shared: true, shareUrl: url, links: ach.shareLinks(v, url), liProfile: ach.linkedinProfileLink(v, url) } });
    assert.ok(on.includes('LinkedIn') && on.includes('Stop sharing') && on.includes('Add to LinkedIn profile'));
    const off = await ejs.renderFile(path.join(views, 'partials/skill-share.ejs'), { candidate: c, s: { key: 'linux', shared: false } });
    assert.ok(off.includes('Share this achievement') && !off.includes('Stop sharing'));
  });
  await t('every card image exists', async () => {
    const fs = require('fs');
    for (const k of ['foundational', 'intermediate', 'advanced', 'master', 'grandmaster']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public/img/share', k + '.png')), k);
  });
  await t('hashtags are cleaned to letters, numbers and underscore', async () => {
    assert.strictEqual(ach.cleanHashtag('#Acme Corp!'), '#AcmeCorp');
    assert.strictEqual(ach.cleanHashtag('##new_job'), '#new_job');
    assert.strictEqual(ach.cleanHashtag('   '), '');
    assert.strictEqual(ach.cleanHashtag('x'.repeat(50)).length, 31);
  });
  await t('a hire share says only "new job through PreCheckd" unless the candidate chose the company', async () => {
    const c = mk(); c.save = async () => {};
    const appId = '507f1f77bcf86cd799439055';
    await ach.setHireShare(c, appId, { on: true, includeCompany: false, company: 'Acme Corp', hashtag: '#NewJob' });
    let v = ach.hireView(c, appId);
    assert.strictEqual(v.company, '');
    assert.strictEqual(v.hashtag, '#NewJob');
    assert.ok(v.headline.includes('Kent M. got a new job, hired through PreCheckd') && !v.headline.includes('Acme') && !v.headline.includes('Mayer'));
    await ach.setHireShare(c, appId, { on: true, includeCompany: true, company: 'Acme Corp', hashtag: '' });
    v = ach.hireView(c, appId);
    assert.strictEqual(v.company, 'Acme Corp');
    assert.ok(v.headline.includes('at Acme Corp'));
    const l = ach.hireShareLinks(v, ach.hireUrlFor(c, appId));
    assert.ok(l.text.includes('Acme Corp') && decodeURIComponent(l.x).includes('Acme Corp'));
    assert.ok(l.copy.endsWith(`/achievements/kent-mayer/hire/${appId}?ref=share`));
    await ach.setHireShare(c, appId, { on: false });
    assert.strictEqual(ach.hireView(c, appId), null);
    assert.strictEqual(ach.hireView(c, '507f1f77bcf86cd799439066'), null);
  });
  await t('the hire setup page and the public announcement render', async () => {
    const c = mk(); c.save = async () => {};
    const appId = '507f1f77bcf86cd799439055';
    const blank = await ejs.renderFile(path.join(views, 'hire-share.ejs'), { candidate: c, appId, jobTitle: 'DevOps Engineer', company: 'Acme Corp', shared: false, v: null, url: '', links: null, saved: false });
    assert.ok(blank.includes('value="none" checked') && blank.includes('Mention the company') && blank.includes('Create my announcement') && !blank.includes('Stop sharing'));
    await ach.setHireShare(c, appId, { on: true, includeCompany: true, company: 'Acme Corp', hashtag: 'AcmeLife' });
    const v = ach.hireView(c, appId); const url = ach.hireUrlFor(c, appId);
    const on = await ejs.renderFile(path.join(views, 'hire-share.ejs'), { candidate: c, appId, jobTitle: 'DevOps Engineer', company: 'Acme Corp', shared: true, v, url, links: ach.hireShareLinks(v, url), saved: true });
    assert.ok(on.includes('value="company" checked') && on.includes('#AcmeLife') && on.includes('LinkedIn') && on.includes('Stop sharing'));
    const page = await ejs.renderFile(path.join(views, 'achievement.ejs'), { v, url });
    assert.ok(page.includes('Kent M. got a new job at Acme Corp') && page.includes('/img/share/hired.png') && !page.includes('Mayer'));
  });
  console.log(`\n${n} achievement tests passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
