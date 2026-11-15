// Run: node tests/integrity-check.test.js
// Our own "too fast for the score" check that holds an attempt for staff review.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const ic = require('../src/services/integrityCheck');
const coderbyte = require('../src/services/coderbyte');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
const answers = (right, total) => Array.from({ length: total }, (_, i) => ({ id: String(i), correct: i < right, tags: [] }));
const res = (o) => Object.assign({ answers: answers(10, 10), timeTakenMinutes: 1, startedAt: null, completedAt: null }, o);
const asm = (o) => Object.assign({ kind: 'skill', tier: 'easy' }, o);

t('10 questions, all right, in 1 minute is held', () => {
  const r = ic.check(res({}), asm());
  assert.strictEqual(r.length, 1); assert.ok(/60 seconds|6 seconds/.test(r[0]));
});
t('a normal pace is not held', () => assert.deepStrictEqual(ic.check(res({ timeTakenMinutes: 9 }), asm()), []));
t('fast but a low score is not held (guessing, not cheating)', () => assert.deepStrictEqual(ic.check(res({ answers: answers(3, 10) }), asm()), []));
t('hard tier: perfect score at 15s a question is held, but not at 25s', () => {
  assert.strictEqual(ic.check(res({ timeTakenMinutes: 2.5 }), asm({ tier: 'hard' })).length, 1);
  assert.deepStrictEqual(ic.check(res({ timeTakenMinutes: 4.2 }), asm({ tier: 'hard' })), []);
});
t('easy tier at 15s a question is fine (the hard rule only applies to Advanced/Expert)', () => assert.deepStrictEqual(ic.check(res({ timeTakenMinutes: 2.5 }), asm()), []));
t('rounded-down minutes never cause a flag: the longer of the two clocks is used', () => {
  const r = res({ timeTakenMinutes: 0, startedAt: new Date('2026-11-14T10:00:00Z'), completedAt: new Date('2026-11-14T10:09:00Z') });
  assert.deepStrictEqual(ic.check(r, asm()), []);
});
t('too few questions, no timing, and custom tests are skipped', () => {
  assert.deepStrictEqual(ic.check(res({ answers: answers(3, 3) }), asm()), []);
  assert.deepStrictEqual(ic.check(res({ timeTakenMinutes: null }), asm()), []);
  assert.deepStrictEqual(ic.check(res({}), asm({ kind: 'custom' })), []);
});
t('applyReport holds the attempt and records why; a clean one is not held', () => {
  const report = (min) => ({ status: 'completed', final_score: 100, time_taken: min, cheating_flag: 'Not detected', cheating_details: {},
    mc_details: answers(10, 10).map((a) => ({ id: a.id, correct: true, meta: { tags: ['X'] } })), skill_ratings: { X: 100 } });
  const a = asm({ skills: [{ key: 'x', label: 'X', ratingKeys: ['X'] }], questions: [] });
  const fast = { status: 'started' }; coderbyte.applyReport(fast, a, report(1));
  assert.strictEqual(fast.held, true); assert.strictEqual(fast.heldReasons.length, 1);
  const slow = { status: 'started' }; coderbyte.applyReport(slow, a, report(12));
  assert.strictEqual(slow.held, false); assert.deepStrictEqual(slow.heldReasons, []);
});
console.log(`\n${n} passed`);
