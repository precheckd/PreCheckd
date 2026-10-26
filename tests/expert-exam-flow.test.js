// The Expert exam through currentSkills, the start rules and the retake lock, with the database stubbed.
const assert = require('assert');
const SkillResult = require('../src/models/SkillResult');
const SkillAssessment = require('../src/models/SkillAssessment');
const skills = require('../src/services/skills');
const coderbyte = require('../src/services/coderbyte');

const DAY = 86400000;
const asm = (id, tier) => ({ assessmentId: id, tier, kind: 'skill', active: true, skills: [{ key: 'linux', label: 'Linux' }] });
const asms = [asm('e', 'easy'), asm('m', 'medium'), asm('h', 'hard'), asm('x', 'expert')];
const res = (assessmentId, tier, right, total, daysAgo) => ({
  candidateId: 'c1', assessmentId, status: 'completed', held: false, completedAt: new Date(Date.now() - daysAgo * DAY),
  skills: [{ key: 'linux', label: 'Linux', score: 80, tiers: { [tier]: { right, total } } }],
});
let results = [];
SkillResult.find = (q) => {
  const rows = results.filter((r) => (!q.assessmentId || r.assessmentId === q.assessmentId) && (!q.status || r.status === q.status));
  const p = Promise.resolve(rows); p.sort = async () => rows; return p;
};
SkillResult.findOne = () => ({ sort: async () => null });
SkillAssessment.find = async () => asms;
SkillAssessment.findOne = async ({ assessmentId }) => asms.find((a) => a.assessmentId === assessmentId) || null;
coderbyte.inviteCandidate = async () => ({ invited: true });

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const cur = async () => (await skills.currentSkills('c1')).find((s) => s.key === 'linux');
const base = [res('e', 'easy', 5, 5, 200), res('m', 'medium', 5, 5, 190), res('h', 'hard', 6, 6, 180)];
const cand = { _id: 'c1' };

(async () => {
  await t('Basic, Intermediate and Advanced tests make Advanced, with no exam yet', async () => {
    results = [...base];
    const s = await cur();
    assert.strictEqual(s.level, 'Advanced');
    assert.strictEqual(s.grandmaster, false);
  });

  await t('19 of 20 on the Expert exam makes Master, 20 of 20 makes Grandmaster', async () => {
    results = [...base, res('x', 'expert', 19, 20, 20)];
    let s = await cur();
    assert.strictEqual(s.level, 'Expert');
    assert.strictEqual(s.grandmaster, false);
    results = [...base, res('x', 'expert', 20, 20, 20)];
    s = await cur();
    assert.strictEqual(s.level, 'Expert');
    assert.strictEqual(s.grandmaster, true);
  });

  await t('a failed exam leaves the candidate at Advanced', async () => {
    results = [...base, res('x', 'expert', 15, 20, 20)];
    assert.strictEqual((await cur()).level, 'Advanced');
  });

  await t('the exam cannot be started below Advanced', async () => {
    results = [res('e', 'easy', 5, 5, 20)];
    await assert.rejects(() => skills.startAttempt(cand, 'x'), (e) => e.code === 'locked');
  });

  await t('the exam can be started at Advanced', async () => {
    results = [...base];
    assert.deepStrictEqual(await skills.startAttempt(cand, 'x'), { invited: true });
  });

  await t('the exam retake wait is 90 days, other tests 60', async () => {
    results = [...base, res('x', 'expert', 15, 20, 70)];
    const wait = await skills.nextAllowed('c1', asms[3]);
    assert.ok(wait && Math.round((wait - Date.now()) / DAY) === 20, String(wait));
    results = [...base, res('h', 'hard', 5, 6, 70)];
    assert.strictEqual(await skills.nextAllowed('c1', asms[2]), null);
  });

  console.log(`\n${n} expert exam flow tests passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
