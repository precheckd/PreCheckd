const assert = require('assert');
const L = require('../src/services/skillLevels');
const { levelName } = require('../src/utils/levelName');
const skills = require('../src/services/skills');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
const T = (right, total) => ({ right, total });
const ladder = (tiers) => L.levelFromTiers(tiers, { ladder: true });

t('hard test passed now gives Advanced, not Expert', () => {
  assert.strictEqual(ladder({ easy: T(5, 5), medium: T(5, 5), hard: T(6, 6) }), 'Advanced');
  assert.strictEqual(ladder({ easy: T(5, 5), medium: T(5, 5), hard: T(2, 6) }), 'Advanced'); // a third of the hard test still counts
  assert.strictEqual(ladder({ easy: T(5, 5), medium: T(5, 5), hard: T(1, 6) }), 'Intermediate');
});

t('Expert exam: 19 of 20 is Master (stored as Expert), 18 of 20 is not', () => {
  const base = { easy: T(5, 5), medium: T(5, 5), hard: T(6, 6) };
  assert.strictEqual(ladder({ ...base, expert: T(19, 20) }), 'Expert');
  assert.strictEqual(ladder({ ...base, expert: T(20, 20) }), 'Expert');
  assert.strictEqual(ladder({ ...base, expert: T(18, 20) }), 'Advanced');
  assert.strictEqual(ladder({ ...base, expert: T(5, 5) }), 'Advanced'); // too short to count as the exam
});

t('the exam does nothing without Advanced', () => {
  assert.strictEqual(ladder({ easy: T(5, 5), medium: T(5, 5), hard: T(0, 6), expert: T(20, 20) }), 'Intermediate');
});

t('the exam on its own (one test of a ladder) reports Master or nothing', () => {
  assert.strictEqual(ladder({ expert: T(20, 20) }), 'Expert');
  assert.strictEqual(ladder({ expert: T(10, 20) }), 'Developing');
});

t('Grandmaster is a perfect Expert exam only', () => {
  assert.strictEqual(L.isGrandmaster(T(20, 20)), true);
  assert.strictEqual(L.isGrandmaster(T(19, 20)), false);
  assert.strictEqual(L.isGrandmaster(T(5, 5)), false);
  assert.strictEqual(L.isGrandmaster(undefined), false);
  assert.strictEqual(L.expertPassed(T(19, 20)), true);
});

t('progress toward Master is measured on the Expert exam', () => {
  const p = L.nextLevelProgress('Advanced', { expert: T(10, 20) });
  assert.strictEqual(p.next, 'Expert');
  assert.strictEqual(p.tier, 'expert');
  assert.strictEqual(p.needed, 19);
  assert.strictEqual(L.nextLevelProgress('Advanced', {}).started, false);
  assert.strictEqual(L.nextLevelProgress('Expert', {}), null);
});

t('weightedSkill scores an Expert exam attempt as its own tier', () => {
  const answers = Array.from({ length: 20 }, (_, i) => ({ id: 'q' + i, correct: i < 19, tags: [] }));
  const diff = new Map(answers.map((a) => [a.id, 'expert']));
  const w = L.weightedSkill(answers, diff, ['Linux'], { ladder: true, allQuestions: true });
  assert.deepStrictEqual(w.tiers.expert, T(19, 20));
  assert.strictEqual(w.level, 'Expert');
});

t('names: Expert shows as Master, a perfect exam as Grandmaster', () => {
  assert.strictEqual(levelName('Expert'), 'Master');
  assert.strictEqual(levelName('Expert', true), 'Grandmaster');
  assert.strictEqual(levelName('Advanced', true), 'Advanced');
  assert.strictEqual(levelName('Intermediate'), 'Intermediate');
  assert.strictEqual(global.levelName('Expert'), 'Master');
});

t('on the skill card the Expert exam is locked until Advanced and then opens', () => {
  const card = (tier) => ({ assessment: { tier, kind: 'skill', skills: [{ key: 'linux', label: 'Linux' }], questions: [] } });
  const cards = ['hard', 'easy', 'expert', 'medium'].map(card);
  const at = (level, tiers) => skills.buildLadders(cards, [{ key: 'linux', level, tiers }])[0];
  const full = { easy: T(5, 5), medium: T(5, 5), hard: T(6, 6) };
  let g = at('Advanced', full);
  assert.deepStrictEqual(g.rungs.map((r) => r.tier), ['easy', 'medium', 'hard', 'expert']);
  assert.strictEqual(g.rungs[3].locked, false);
  assert.strictEqual(g.rungs[3].passed, false);
  assert.strictEqual(g.progress.next, 'Expert');
  g = at('Intermediate', { easy: T(5, 5), medium: T(5, 5) });
  assert.strictEqual(g.rungs[3].locked, true);
  g = at('Expert', { ...full, expert: T(20, 20) });
  assert.strictEqual(g.rungs[3].passed, true);
  assert.strictEqual(g.topLevel, true);
});

console.log(`\n${n} expert exam tests passed`);
