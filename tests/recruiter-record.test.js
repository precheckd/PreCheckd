// Run: node tests/recruiter-record.test.js
// A recruiter's public record: active postings always, outcome history only after a first closed job, confirmed hires only.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const { summarize } = require('../src/services/recruiterRecord');

const NOW = new Date('2026-11-05T12:00:00Z').getTime();
const day = 24 * 60 * 60 * 1000;
const open = (offset = 5) => ({ status: 'open', closeDate: new Date(NOW + offset * day) });
const closed = (kind, hires = []) => ({ status: 'closed', closeDate: new Date(NOW - day), outcome: { kind, hires } });
const hire = (source, status = 'confirmed') => ({ source, status });
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('a new recruiter shows active postings and no history', () => {
  const r = summarize([open(), open()], NOW);
  assert.strictEqual(r.openNow, 2);
  assert.strictEqual(r.showHistory, false);
});
t('an open posting past its close date is not active', () => {
  assert.strictEqual(summarize([open(-1)], NOW).openNow, 0);
});
t('awaiting_outcome and removed postings are neither active nor closed', () => {
  const r = summarize([{ status: 'awaiting_outcome', closeDate: new Date(NOW - day) }, { status: 'removed' }], NOW);
  assert.strictEqual(r.openNow, 0);
  assert.strictEqual(r.closed, 0);
  assert.strictEqual(r.showHistory, false);
});
t('history appears after the first closed job with an outcome', () => {
  const r = summarize([closed('not_filled')], NOW);
  assert.strictEqual(r.showHistory, true);
  assert.strictEqual(r.closed, 1);
  assert.strictEqual(r.notFilled, 1);
  assert.strictEqual(r.hiresTotal, 0);
});
t('only confirmed hires count, split by where they came from', () => {
  const r = summarize([
    closed('hired_precheckd', [hire('precheckd'), hire('precheckd', 'pending'), hire('precheckd', 'denied')]),
    closed('hired_elsewhere', [hire('elsewhere'), hire('elsewhere', 'expired')]),
  ], NOW);
  assert.deepStrictEqual([r.hiresPrecheckd, r.hiresElsewhere, r.hiresTotal], [1, 1, 2]);
  assert.strictEqual(r.closed, 2);
});
t('cancelled jobs count as closed and as not filled or cancelled', () => {
  const r = summarize([closed('cancelled'), closed('not_filled'), closed('hired_precheckd', [hire('precheckd')])], NOW);
  assert.deepStrictEqual([r.closed, r.notFilled, r.hiresTotal], [3, 2, 1]);
});
t('a job auto-closed with no outcome reported counts as closed but never as a hire', () => {
  const r = summarize([closed('no_outcome')], NOW);
  assert.deepStrictEqual([r.closed, r.hiresTotal, r.notFilled], [1, 0, 0]);
});
t('nothing is shown as a percentage', () => {
  const r = summarize([closed('hired_precheckd', [hire('precheckd')])], NOW);
  assert.ok(!Object.keys(r).some((k) => /rate|percent|ratio/i.test(k)));
});
console.log(n + ' passed');
