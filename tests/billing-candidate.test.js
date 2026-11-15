// Run: node tests/billing-candidate.test.js
// Candidate plans, the $79 fee and founding-1,000 waiver, checkout contents, and fee recording. Stripe and the database are stubbed.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.BILLING_ENABLED = 'true';
const assert = require('assert');
const plans = require('../src/services/billingPlans');
const Candidate = require('../src/models/Candidate');
const Recruiter = require('../src/models/Recruiter');
const BillingEvent = require('../src/models/BillingEvent');
const cb = require('../src/services/candidateBilling');
const webhook = require('../src/services/billingWebhook');
const membership = require('../src/services/membership');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const DAY = 86400000;
const now = new Date('2026-11-14T12:00:00Z');
const secs = (d) => Math.floor(d.getTime() / 1000);

function newCandidate(over) {
  return Object.assign({ _id: 'c1', email: 'a@b.com', firstName: 'A', lastName: 'B', isIdentityVerified: false,
    billing: { status: 'none', customerId: null, founding: {}, verificationFee: { paidAt: null, waived: false } }, save: async function () {} }, over || {});
}
function fakeStripe(capture) {
  return {
    customers: { create: async () => ({ id: 'cus_c' }) },
    prices: { list: async ({ lookup_keys }) => ({ data: [{ id: 'price_' + lookup_keys[0] }] }),  create: async () => { throw new Error('should not create'); } },
    checkout: { sessions: { create: async (a) => { capture.args = a; return { url: 'https://stripe.test/c' }; } } },
  };
}

(async () => {
  await t('prices: $15 a month, $120 a year, $79 one time (no recurring)', async () => {
    assert.strictEqual(plans.PLANS.candidate_monthly.cents, 1500);
    assert.strictEqual(plans.PLANS.candidate_annual.cents, 12000);
    assert.strictEqual(plans.PLANS.candidate_fee.cents, 7900);
    plans.clearCache();
    const made = [];
    const stripe = { prices: { list: async () => ({ data: [] }), create: async (p) => { made.push(p); return { id: 'p_' + p.lookup_key }; } } };
    await plans.ensurePrice(stripe, 'candidate_fee');
    assert.strictEqual(made[0].recurring, undefined); assert.strictEqual(made[0].unit_amount, 7900);
  });
  await t('who owes the fee: founding spot waives it, verified or already-paid people never owe it', async () => {
    const f = (o) => plans.chooseCandidatePlan(Object.assign({ interval: 'monthly', foundingSpotsLeft: 0, alreadyFounding: false, hadFee: false, idVerified: false }, o));
    assert.strictEqual(f({}).feeDue, true);
    assert.strictEqual(f({ foundingSpotsLeft: 5 }).feeDue, false);
    assert.strictEqual(f({ foundingSpotsLeft: 5 }).founding, true);
    assert.strictEqual(f({ alreadyFounding: true }).feeDue, false);
    assert.strictEqual(f({ hadFee: true }).feeDue, false);
    assert.strictEqual(f({ idVerified: true }).feeDue, false);
    assert.strictEqual(f({ interval: 'weekly' }), null);
    assert.strictEqual(f({ interval: 'annual' }).plan, 'candidate_annual');
  });

  await t('checkout with a founding spot: one line item, spot held, no fee', async () => {
    plans.clearCache(); Candidate.countDocuments = async () => 0;
    const c = newCandidate(); const cap = {};
    const out = await cb.startCheckout({ stripe: fakeStripe(cap), candidate: c, interval: 'monthly', baseUrl: 'https://precheckd.com', successPath: '/candidate-billing/return', cancelPath: '/x', now });
    assert.strictEqual(cap.args.line_items.length, 1);
    assert.strictEqual(cap.args.line_items[0].price, 'price_precheckd_candidate_monthly');
    assert.strictEqual(cap.args.metadata.verificationFee, '0');
    assert.deepStrictEqual(cap.args.automatic_tax, { enabled: true });
    assert.strictEqual(c.billing.founding.wave, 1); assert.ok(c.billing.founding.reservedAt); assert.strictEqual(c.billing.verificationFee.waived, true);
    assert.strictEqual(out.feeDue, false);
  });
  await t('checkout after the 1,000 are taken: monthly plan plus the $79 fee in the same payment', async () => {
    plans.clearCache(); Candidate.countDocuments = async () => 1000;
    const c = newCandidate(); const cap = {};
    const out = await cb.startCheckout({ stripe: fakeStripe(cap), candidate: c, interval: 'annual', baseUrl: '', successPath: '/r', cancelPath: '/x', now });
    assert.strictEqual(cap.args.line_items.length, 2);
    assert.strictEqual(cap.args.line_items[1].price, 'price_precheckd_candidate_verification_fee');
    assert.strictEqual(cap.args.metadata.verificationFee, '1');
    assert.strictEqual(c.billing.verificationFee.waived, false); assert.strictEqual(c.billing.founding.wave || null, null);
    assert.strictEqual(out.feeDue, true);
  });
  await t('a lapsed member who comes back does not pay the fee again', async () => {
    plans.clearCache(); Candidate.countDocuments = async () => 1000;
    const c = newCandidate({ isIdentityVerified: true, billing: { status: 'canceled', customerId: 'cus_c', founding: {}, verificationFee: { paidAt: new Date(now.getTime() - 90 * DAY), waived: false } } });
    const cap = {};
    await cb.startCheckout({ stripe: fakeStripe(cap), candidate: c, interval: 'monthly', baseUrl: '', successPath: '/r', cancelPath: '/x', now });
    assert.strictEqual(cap.args.line_items.length, 1);
  });
  await t('a member cannot start a second subscription', async () => {
    const c = newCandidate({ billing: { status: 'active', founding: {}, verificationFee: {} } });
    await assert.rejects(cb.startCheckout({ stripe: {}, candidate: c, interval: 'monthly', baseUrl: '', successPath: '/r', cancelPath: '/x', now }), (e) => e.code === 'already_active');
  });

  const subObj = { id: 'sub_c', customer: 'cus_c', status: 'active', cancel_at_period_end: false, current_period_end: secs(new Date(now.getTime() + 30 * DAY)),
    items: { data: [{ price: { recurring: { interval: 'month' } } }] } };
  await t('return from Checkout: member, fee recorded, founding spot locked; someone else\'s session refused', async () => {
    const c = newCandidate({ billing: { status: 'incomplete', customerId: 'cus_c', founding: { wave: 1, reservedAt: now, lockedAt: null }, verificationFee: { paidAt: null, waived: false } } });
    const st = (s) => ({ checkout: { sessions: { retrieve: async () => s } }, subscriptions: { retrieve: async () => subObj } });
    await assert.rejects(cb.confirmReturn({ stripe: st({ client_reference_id: 'zzz', mode: 'subscription', subscription: 's', payment_status: 'paid' }), candidate: c, sessionId: 'cs', now }), (e) => e.code === 'mismatch');
    const r = await cb.confirmReturn({ stripe: st({ client_reference_id: 'c1', mode: 'subscription', subscription: 's', payment_status: 'paid', metadata: { verificationFee: '1' } }), candidate: c, sessionId: 'cs', now });
    assert.strictEqual(r.paid, true); assert.ok(c.billing.verificationFee.paidAt); assert.ok(c.billing.founding.lockedAt);
    assert.strictEqual(membership.isMember(c, now), true);
  });
  await t('webhook: a candidate checkout records the fee once; a repeated event is skipped', async () => {
    const events = new Map();
    BillingEvent.create = async (d) => { if (events.has(d.eventId)) { const e = new Error('dup'); e.code = 11000; throw e; } events.set(d.eventId, d); return d; };
    BillingEvent.updateOne = async () => {}; BillingEvent.deleteOne = async (q) => { events.delete(q.eventId); };
    const c = newCandidate({ billing: { status: 'incomplete', customerId: 'cus_c', founding: {}, verificationFee: { paidAt: null, waived: false } }, saves: 0 });
    const origSave = c.save; c.save = async function () { this.saves++; return origSave.call(this); };
    Candidate.findById = async (id) => (id === 'c1' ? c : null); Candidate.findOne = async () => null; Recruiter.findById = async () => null; Recruiter.findOne = async () => null;
    const ev = { id: 'evt_c1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_c', customer: 'cus_c', payment_status: 'paid', metadata: { ownerType: 'candidate', ownerId: 'c1', verificationFee: '1' } } } };
    const stripe = { subscriptions: { retrieve: async () => subObj } };
    await webhook.handleEvent(ev, { stripe, now });
    assert.strictEqual(c.billing.status, 'active'); assert.ok(c.billing.verificationFee.paidAt);
    assert.strictEqual((await webhook.handleEvent(ev, { stripe, now })).duplicate, true); assert.strictEqual(c.saves, 1);
  });
  await t('a founding spot is kept after lapsing, but a lapsed candidate is not a member', async () => {
    const c = newCandidate({ billing: { status: 'canceled', currentPeriodEnd: new Date(now.getTime() - DAY), founding: { wave: 1, lockedAt: now }, verificationFee: {} } });
    assert.strictEqual(cb.alreadyFounding(c), true);
    assert.strictEqual(membership.isMember(c, now), false); assert.strictEqual(membership.isLapsed(c, now), true);
  });

  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
