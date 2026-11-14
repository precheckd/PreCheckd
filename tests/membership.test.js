// Run: node tests/membership.test.js
// Membership state, the BILLING_ENABLED switch, and the apply-gate fact. Pure logic, no database.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const membership = require('../src/services/membership');
const { toFacts } = require('../src/services/applyFacts');
const { evaluate } = require('../src/services/applyGate');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
const DAY = 86400000;
const now = new Date('2026-11-14T12:00:00Z');
const acct = (billing) => ({ billing });

process.env.BILLING_ENABLED = 'false';
t('billing off: everyone is a member, nobody is lapsed', () => {
  assert.strictEqual(membership.isMember(acct({ status: 'canceled' }), now), true);
  assert.strictEqual(membership.isLapsed(acct({ status: 'canceled' }), now), false);
  assert.strictEqual(membership.gateFact(acct({ status: 'canceled' }), now), undefined);
});

process.env.BILLING_ENABLED = 'true';
t('active is a member', () => {
  assert.strictEqual(membership.isMember(acct({ status: 'active' }), now), true);
  assert.strictEqual(membership.state(acct({ status: 'active' }), now).status, 'active');
});
t('failed payment: member during the 14 days, lapsed after', () => {
  const inGrace = acct({ status: 'past_due', graceUntil: new Date(now.getTime() + 3 * DAY) });
  assert.strictEqual(membership.state(inGrace, now).status, 'grace');
  assert.strictEqual(membership.isMember(inGrace, now), true);
  assert.strictEqual(membership.graceDaysLeft(inGrace, now), 3);
  const over = acct({ status: 'past_due', graceUntil: new Date(now.getTime() - DAY) });
  assert.strictEqual(membership.state(over, now).status, 'lapsed');
  assert.strictEqual(membership.isMember(over, now), false);
  assert.strictEqual(membership.isLapsed(over, now), true);
});
t('past_due with no grace date lapses (never grants open-ended access)', () => {
  assert.strictEqual(membership.isMember(acct({ status: 'past_due' }), now), false);
});
t('cancelled keeps access to the end of the paid period', () => {
  const paid = acct({ status: 'canceled', currentPeriodEnd: new Date(now.getTime() + 5 * DAY) });
  assert.strictEqual(membership.isMember(paid, now), true);
  const ended = acct({ status: 'canceled', currentPeriodEnd: new Date(now.getTime() - DAY) });
  assert.strictEqual(membership.isMember(ended, now), false);
  assert.strictEqual(membership.isLapsed(ended, now), true);
});
t('never subscribed: not a member, but not shown as lapsed', () => {
  assert.strictEqual(membership.isMember(acct({ status: 'none' }), now), false);
  assert.strictEqual(membership.isLapsed(acct({ status: 'none' }), now), false);
  assert.strictEqual(membership.isMember({}, now), false);
});
t('apply gate: lapsed candidate is blocked with the renew action; billing off leaves the gate alone', () => {
  const cand = { emailVerifiedAt: new Date(), isPhoneVerified: true, isIdentityVerified: true, billing: { status: 'canceled' } };
  const posting = { status: 'open', closeDate: new Date(now.getTime() + DAY), skills: [] };
  const blocked = evaluate(toFacts(cand, { posting: null }), posting, now);
  assert.ok(blocked.blockers.some((b) => b.code === 'membership_inactive'));
  process.env.BILLING_ENABLED = 'false';
  const open = evaluate(toFacts(cand, { posting: null }), posting, now);
  assert.ok(!open.blockers.some((b) => b.code === 'membership_inactive'));
});
console.log(`${n} passed`);
