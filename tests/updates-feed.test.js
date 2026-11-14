// Run: node tests/updates-feed.test.js
// The Updates feed: who is told what, and never twice. Database layer stubbed (no MongoDB here).
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.ENABLE_UPDATES = 'true';
const assert = require('assert');
const FeedItem = require('../src/models/FeedItem');
const ConnectionRequest = require('../src/models/ConnectionRequest');
const Candidate = require('../src/models/Candidate');
const skills = require('../src/services/skills');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

const feed = [];
FeedItem.create = async (d) => {
  if (feed.some((x) => x.ownerId === d.ownerId && x.ownerType === d.ownerType && x.key === d.key)) throw new Error('dup');
  feed.push(d); return d;
};
let links = [{ recruiterId: 'r1' }, { recruiterId: 'r2' }, { recruiterId: 'r1' }];
ConnectionRequest.find = () => ({ select: async () => links });
ConnectionRequest.exists = async (q) => links.some((l) => l.recruiterId === q.recruiterId) ? { _id: 1 } : null;
Candidate.updateOne = async () => ({});
let current = [];
skills.currentSkills = async () => current;

const mk = (over) => Object.assign({
  _id: 'c1', firstName: 'Dana', lastName: 'Lee', shareUpdates: true, announcedKeys: [], hiddenSkillKeys: [],
  certifications: [{ name: 'Security+', verified: true }, { name: 'CISSP', verified: false }],
  educationHistory: [{ schoolName: 'WGU', degree: 'BS Computer Science', verified: true }]
}, over);

const { sweepCandidate, jobForCandidate } = require('../src/services/updates');

(async () => {
  await t('verified cert and degree go to each connected recruiter once; unverified ones do not', async () => {
    const c = mk();
    const sent = await sweepCandidate(c);
    assert.strictEqual(sent, 4); // 2 facts x 2 distinct recruiters
    assert.ok(feed.some((f) => f.text === 'Dana L. earned a verified Security+ certification.'));
    assert.ok(!feed.some((f) => /CISSP/.test(f.text)));
    assert.strictEqual(await sweepCandidate(c), 0); // nothing new the second time
  });
  await t('switch off: nothing sent, but facts are marked seen so turning it on later sends no backlog', async () => {
    feed.length = 0;
    const c = mk({ shareUpdates: false });
    assert.strictEqual(await sweepCandidate(c), 0);
    assert.strictEqual(feed.length, 0);
    assert.ok(c.announcedKeys.length >= 2);
    c.shareUpdates = true;
    assert.strictEqual(await sweepCandidate(c), 0);
  });
  await t('silent sweep (switch just turned on) sends nothing', async () => {
    feed.length = 0;
    const c = mk();
    assert.strictEqual(await sweepCandidate(c, { silent: true }), 0);
    assert.strictEqual(feed.length, 0);
  });
  await t('only shown skill levels are announced; hidden and below-Foundational never are', async () => {
    feed.length = 0;
    current = [{ key: 'linux', label: 'Linux', level: 'Intermediate' }, { key: 'sql', label: 'SQL', level: 'Advanced' }, { key: 'git', label: 'Git', level: 'Developing' }];
    const c = mk({ certifications: [], educationHistory: [], hiddenSkillKeys: ['sql'] });
    await sweepCandidate(c);
    const texts = feed.map((f) => f.text);
    assert.ok(texts.some((x) => /Linux/.test(x)));
    assert.ok(!texts.some((x) => /SQL/.test(x)) && !texts.some((x) => /Git/.test(x)));
  });
  await t('a new level in the same skill is announced; a retake at the same level is not', async () => {
    feed.length = 0;
    const c = mk({ certifications: [], educationHistory: [], announcedKeys: ['skill:linux:Intermediate'] });
    current = [{ key: 'linux', label: 'Linux', level: 'Intermediate' }];
    assert.strictEqual(await sweepCandidate(c), 0);
    current = [{ key: 'linux', label: 'Linux', level: 'Advanced' }];
    assert.strictEqual(await sweepCandidate(c), 2);
  });
  await t('a connection that ended gets nothing (only accepted links are read)', async () => {
    feed.length = 0; links = [];
    assert.strictEqual(await sweepCandidate(mk({ announcedKeys: [] })), 0);
    links = [{ recruiterId: 'r1' }];
  });
  await t('a recruiter job reaches only a candidate connected to that recruiter', async () => {
    feed.length = 0;
    const posting = { _id: 'p1', recruiterId: 'r1', title: 'Linux Administrator', hiringCompany: 'Acme' };
    assert.ok(await jobForCandidate({ _id: 'c1' }, posting, '/jobs/p1/x'));
    assert.ok(!(await jobForCandidate({ _id: 'c2' }, { ...posting, recruiterId: 'r9' }, '/jobs/p1/x')));
    assert.ok(!(await jobForCandidate({ _id: 'c1' }, posting, '/jobs/p1/x'))); // already there
    assert.strictEqual(feed.length, 1);
    assert.strictEqual(feed[0].ownerType, 'candidate');
  });
  console.log(`\n${n} passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
