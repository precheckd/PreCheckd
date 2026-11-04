// Run: node tests/applicant-queue.test.js
// The review queue: a job pauses while too many applicants are waiting on a decision, and only a real decision frees a place.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const JobApplication = require('../src/models/JobApplication');
const { evaluate } = require('../src/services/applyGate');
const queue = require('../src/services/applicantQueue');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

(async () => {
  await t('the limit is 20 by default and the warning comes at 15', () => {
    assert.strictEqual(queue.LIMIT, 20);
    assert.strictEqual(queue.WARN_AT, 15);
  });

  await t('only Applied and Screening count as waiting', () => {
    assert.deepStrictEqual(queue.WAITING, ['applied', 'screening']);
  });

  await t('a full queue blocks a new applicant with a clear message', () => {
    const r = evaluate({ verified: { email: true, phone: true, identity: true } }, { status: 'open', queueFull: true });
    assert.strictEqual(r.canApply, false);
    assert.strictEqual(r.blockers[0].code, 'queue_full');
    assert.ok(r.blockers[0].message.includes('paused'));
  });

  await t('someone who already applied is not told the job is paused', () => {
    const r = evaluate({ alreadyApplied: true, verified: { email: true, phone: true, identity: true } }, { status: 'open', queueFull: true });
    assert.ok(!r.blockers.some((b) => b.code === 'queue_full'));
  });

  await t('a queue with room does not block', () => {
    const r = evaluate({ verified: { email: true, phone: true, identity: true } }, { status: 'open', queueFull: false });
    assert.ok(!r.blockers.some((b) => b.code === 'queue_full'));
  });

  await t('gateShape marks the job full at the limit and not below it', async () => {
    const posting = { _id: 'p1', toGateShape: () => ({ status: 'open' }) };
    let count = 19;
    const orig = JobApplication.countDocuments;
    JobApplication.countDocuments = async () => count;
    try {
      assert.strictEqual((await queue.gateShape(posting)).queueFull, false);
      count = 20;
      assert.strictEqual((await queue.gateShape(posting)).queueFull, true);
    } finally { JobApplication.countDocuments = orig; }
  });

  console.log(`\n${n} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
