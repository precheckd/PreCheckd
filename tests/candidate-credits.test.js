// Run: node tests/candidate-credits.test.js
// Candidate skill-test credits: the monthly window, refunds, spending order, the start hook, and asking for more.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.MOCK_EMAIL = 'true';
const assert = require('assert');
const SkillResult = require('../src/models/SkillResult');
const CreditRequest = require('../src/models/CreditRequest');
const Candidate = require('../src/models/Candidate');
const credits = require('../src/services/candidateCredits');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const D = (s) => new Date(s);
const row = (o) => Object.assign({ creditSpent: 'monthly', status: 'started', startedAt: D('2026-11-02'), invitedAt: D('2026-11-02') }, o);

(async () => {
  await t('window runs from the anchor day each month, clamped to short months', () => {
    const w = credits.creditWindow(D('2026-01-31T10:00:00Z'), D('2026-02-15T00:00:00Z'));
    assert.strictEqual(w.start.toISOString().slice(0, 10), '2026-01-31');
    assert.strictEqual(w.end.toISOString().slice(0, 10), '2026-02-28');
    const w2 = credits.creditWindow(D('2026-03-14T10:00:00Z'), D('2026-11-14T12:00:00Z'));
    assert.strictEqual(w2.start.toISOString().slice(0, 10), '2026-11-14');
    assert.strictEqual(w2.end.toISOString().slice(0, 10), '2026-12-14');
    const w3 = credits.creditWindow(D('2026-03-14T10:00:00Z'), D('2026-11-13T12:00:00Z'));
    assert.strictEqual(w3.start.toISOString().slice(0, 10), '2026-10-14');
  });
  await t('tally counts this month only, and unopened expired invites give the credit back', () => {
    const window = { start: D('2026-11-01'), end: D('2026-12-01') };
    const now = D('2026-11-14');
    const rows = [row({}), row({ invitedAt: D('2026-10-20') }),
      row({ status: 'invited', startedAt: null, expiresAt: D('2026-11-10') }),
      row({ status: 'invited', startedAt: null, expiresAt: D('2026-11-20') })];
    const r = credits.tally({ rows, granted: 0, perMonth: 3, window, now });
    assert.strictEqual(r.monthlyUsed, 2); assert.strictEqual(r.monthlyLeft, 1); assert.strictEqual(r.left, 1);
  });
  await t('bonus credits are lifetime and counted separately', () => {
    const window = { start: D('2026-11-01'), end: D('2026-12-01') };
    const rows = [row({}), row({}), row({}), row({ creditSpent: 'bonus', invitedAt: D('2026-08-01') })];
    const r = credits.tally({ rows, granted: 4, perMonth: 3, window, now: D('2026-11-14') });
    assert.strictEqual(r.monthlyLeft, 0); assert.strictEqual(r.bonusLeft, 3); assert.strictEqual(r.left, 3);
  });
  await t('hooks do nothing while billing is off', () => {
    delete process.env.BILLING_ENABLED;
    assert.deepStrictEqual(credits.hooks({ _id: 'c' }), {});
  });
  await t('hooks block when out, spend monthly first, then bonus; non-skill tests are free', async () => {
    process.env.BILLING_ENABLED = 'true';
    let rows = [];
    SkillResult.find = async () => rows;
    CreditRequest.findOne = () => { const p = Promise.resolve(null); p.sort = () => Promise.resolve(null); return p; };
    const cand = { _id: 'c1', creditBonusGranted: 1, billing: { memberSince: new Date(Date.now() - 86400000) }, createdAt: new Date() };
    const h = credits.hooks(cand);
    await h.beforeInvite({ kind: 'title' }); // free, no throw, no plan
    const free = { save: async () => { throw new Error('should not save'); } };
    await h.afterInvite(free);
    const spent = [];
    for (let i = 0; i < 4; i++) {
      const hh = credits.hooks(cand);
      try {
        await hh.beforeInvite({ kind: 'skill' });
        const res = row({ invitedAt: new Date(), save: async function () {} });
        delete res.creditSpent;
        await hh.afterInvite(res); spent.push(res.creditSpent); rows.push(res);
      } catch (e) { spent.push(e.code); }
    }
    assert.deepStrictEqual(spent, ['monthly', 'monthly', 'monthly', 'bonus']);
    const hh = credits.hooks(cand);
    await assert.rejects(() => hh.beforeInvite({ kind: 'skill' }), (e) => e.code === 'no_credits');
  });
  await t('requesting more: validates, one open at a time', async () => {
    let open = null; const made = [];
    CreditRequest.findOne = async () => open;
    CreditRequest.create = async (d) => { made.push(d); open = d; return d; };
    const c = { _id: 'c1', firstName: 'A', lastName: 'B' };
    await assert.rejects(() => credits.requestMore(c, 0, 'because I need it'), (e) => e.code === 'bad_amount');
    await assert.rejects(() => credits.requestMore(c, 3, 'x'), (e) => e.code === 'no_reason');
    await credits.requestMore(c, 3, 'Interviewing in several areas');
    assert.strictEqual(made.length, 1);
    await assert.rejects(() => credits.requestMore(c, 2, 'again please'), (e) => e.code === 'open');
  });
  await t('staff approval adds bonus credits; declining adds none; double decision refused', async () => {
    const cand = { _id: 'c1', slug: 'a-b', creditBonusGranted: 1, save: async function () {} };
    const mk = () => ({ status: 'open', candidateId: 'c1', amount: 3, save: async function () {} });
    let reqDoc = mk();
    CreditRequest.findById = async () => reqDoc;
    Candidate.findById = async () => cand;
    const Notification = require('../src/models/Notification');
    const sent = []; Notification.create = async (d) => { sent.push(d); return d; };
    await credits.decide('r', { grant: 2, note: 'Good luck!' });
    assert.strictEqual(cand.creditBonusGranted, 3); assert.strictEqual(reqDoc.status, 'approved'); assert.strictEqual(reqDoc.grantedAmount, 2);
    await assert.rejects(() => credits.decide('r', { grant: 2 }), (e) => e.code === 'closed');
    reqDoc = mk(); await credits.decide('r', { grant: 0, note: '' });
    assert.strictEqual(cand.creditBonusGranted, 3); assert.strictEqual(reqDoc.status, 'declined');
  });
  console.log(`\n${n} passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
