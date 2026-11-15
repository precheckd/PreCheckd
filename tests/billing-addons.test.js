// Run: node tests/billing-addons.test.js
// Recruiter add-ons: graduated slot price, buying and changing slots, credit packs, and how bought credits are spent.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.BILLING_ENABLED = 'true';
process.env.MOCK_EMAIL = 'true';
const assert = require('assert');
const plans = require('../src/services/billingPlans');
const addons = require('../src/services/recruiterAddons');
const membership = require('../src/services/membership');
const BillingEvent = require('../src/models/BillingEvent');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const TestRequest = require('../src/models/TestRequest');
const webhook = require('../src/services/billingWebhook');
const testRequests = require('../src/services/testRequests');
const emailService = require('../src/services/emailService');
const sentEmails = [];
emailService.sendBillingNoticeEmail = async (to, first, notice) => { sentEmails.push(notice.subject); };

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const now = new Date('2026-11-14T12:00:00Z');
const memberBilling = (extra) => Object.assign({ status: 'active', customerId: 'cus_1', subscriptionId: 'sub_main', slots: { status: 'none', quantity: 0 }, testCreditsPurchased: 0, fulfilledSessions: [] }, extra);
const mk = (extra) => ({ _id: 'r1', email: 'r@co.com', firstName: 'R', billing: memberBilling(extra), save: async function () { this.saves = (this.saves || 0) + 1; } });

(async () => {
  await t('slot price is graduated: $10 for 1-5, $8 for 6-10, $6 from 11', async () => {
    assert.strictEqual(plans.slotMonthlyCents(0), 0);
    assert.strictEqual(plans.slotMonthlyCents(1), 1000);
    assert.strictEqual(plans.slotMonthlyCents(5), 5000);
    assert.strictEqual(plans.slotMonthlyCents(7), 5000 + 1600);
    assert.strictEqual(plans.slotMonthlyCents(12), 5000 + 4000 + 1200);
  });
  await t('the slot price is created as graduated tiers; the pack as a one-time price', async () => {
    plans.clearCache(); const made = [];
    const stripe = { prices: { list: async () => ({ data: [] }), create: async (p) => { made.push(p); return { id: 'p_' + p.lookup_key }; } } };
    await plans.ensurePrice(stripe, 'recruiter_slot'); await plans.ensurePrice(stripe, 'recruiter_credit_pack');
    assert.strictEqual(made[0].tiers_mode, 'graduated'); assert.strictEqual(made[0].billing_scheme, 'tiered'); assert.strictEqual(made[0].unit_amount, undefined);
    assert.strictEqual(made[0].tiers[2].up_to, 'inf'); assert.strictEqual(made[0].recurring.interval, 'month');
    assert.strictEqual(made[1].unit_amount, 3900); assert.strictEqual(made[1].recurring, undefined);
  });

  await t('buying slots the first time goes to Checkout as its own subscription; non-members are refused', async () => {
    plans.clearCache(); let args = null;
    const stripe = { prices: { list: async () => ({ data: [{ id: 'price_slot' }] }) }, checkout: { sessions: { create: async (a) => { args = a; return { url: 'https://stripe.test/s' }; } } } };
    const out = await addons.setSlots({ stripe, recruiter: mk(), quantity: 3, openCount: 2, baseUrl: 'https://precheckd.com' });
    assert.strictEqual(out.url, 'https://stripe.test/s'); assert.strictEqual(args.mode, 'subscription');
    assert.strictEqual(args.line_items[0].quantity, 3); assert.strictEqual(args.metadata.kind, 'slots'); assert.strictEqual(args.subscription_data.metadata.kind, 'slots');
    assert.deepStrictEqual(args.automatic_tax, { enabled: true });
    await assert.rejects(addons.setSlots({ stripe, recruiter: mk({ status: 'none' }), quantity: 1, baseUrl: '' }), (e) => e.code === 'not_member');
    await assert.rejects(addons.setSlots({ stripe, recruiter: mk(), quantity: 99, baseUrl: '' }), (e) => e.code === 'bad_quantity');
    await assert.rejects(addons.setSlots({ stripe, recruiter: mk(), quantity: 0, baseUrl: '' }), (e) => e.code === 'bad_quantity');
  });
  await t('changing slots later updates the subscription; cannot go below the postings in use', async () => {
    const r = mk({ slots: { status: 'active', quantity: 3, subscriptionId: 'sub_slot', itemId: 'si_1' } });
    let upd = null;
    const stripe = { subscriptions: { update: async (id, p) => { upd = { id, p }; return { id, status: 'active', items: { data: [{ id: 'si_1', quantity: p.items ? p.items[0].quantity : 3 }] } }; } } };
    await assert.rejects(addons.setSlots({ stripe, recruiter: r, quantity: 1, openCount: 7, baseUrl: '' }), (e) => e.code === 'in_use');
    await addons.setSlots({ stripe, recruiter: r, quantity: 5, openCount: 7, baseUrl: '' });
    assert.strictEqual(upd.id, 'sub_slot'); assert.strictEqual(upd.p.items[0].quantity, 5);
    assert.strictEqual(r.billing.slots.quantity, 5); assert.strictEqual(membership.openLimit(r), 10);
    await addons.setSlots({ stripe, recruiter: r, quantity: 0, openCount: 3, baseUrl: '' });
    assert.strictEqual(upd.p.cancel_at_period_end, true);
  });

  await t('credit packs: Checkout is a one-time payment; credits are added once however many times it is seen', async () => {
    plans.clearCache(); let args = null;
    const stripe = { prices: { list: async () => ({ data: [{ id: 'price_pack' }] }) }, checkout: { sessions: { create: async (a) => { args = a; return { url: 'u' }; } } } };
    await addons.startPackCheckout({ stripe, recruiter: mk(), packs: 2, baseUrl: '' });
    assert.strictEqual(args.mode, 'payment'); assert.strictEqual(args.line_items[0].quantity, 2); assert.strictEqual(args.metadata.kind, 'credit_pack');
    const r = mk(); const session = { id: 'cs_1', payment_status: 'paid', metadata: { kind: 'credit_pack', packs: '2' } };
    assert.strictEqual(addons.fulfillPack(r, session), true); assert.strictEqual(r.billing.testCreditsPurchased, 6);
    assert.strictEqual(addons.fulfillPack(r, session), false); assert.strictEqual(r.billing.testCreditsPurchased, 6);
    assert.strictEqual(addons.fulfillPack(mk(), { id: 'cs_2', payment_status: 'unpaid', metadata: { kind: 'credit_pack', packs: '1' } }), false);
  });

  // ---- through the webhook
  const events = new Map();
  BillingEvent.create = async (d) => { if (events.has(d.eventId)) { const e = new Error('dup'); e.code = 11000; throw e; } events.set(d.eventId, d); return d; };
  BillingEvent.updateOne = async () => {}; BillingEvent.deleteOne = async (q) => { events.delete(q.eventId); };
  const rec = mk(); Recruiter.findById = async (id) => (id === 'r1' ? rec : null); Recruiter.findOne = async (q) => (q['billing.customerId'] === 'cus_1' ? rec : null);
  Candidate.findOne = async () => null; Candidate.findById = async () => null;
  const ev = (id, type, object) => ({ id, type, data: { object } });
  const slotSub = (o) => Object.assign({ id: 'sub_slot', customer: 'cus_1', status: 'active', items: { data: [{ id: 'si_9', quantity: 4 }] }, metadata: { ownerType: 'recruiter', ownerId: 'r1', kind: 'slots' } }, o);

  await t('webhook: a paid pack adds credits once; a repeated event is skipped', async () => {
    const e = ev('w1', 'checkout.session.completed', { id: 'cs_9', mode: 'payment', payment_status: 'paid', customer: 'cus_1', metadata: { ownerType: 'recruiter', ownerId: 'r1', kind: 'credit_pack', packs: '1' } });
    await webhook.handleEvent(e, { stripe: {}, now });
    assert.strictEqual(rec.billing.testCreditsPurchased, 3);
    assert.strictEqual((await webhook.handleEvent(e, { stripe: {}, now })).duplicate, true);
    // the same session seen again under a different event id (page return + webhook) still adds nothing
    await webhook.handleEvent(ev('w1b', 'checkout.session.completed', { id: 'cs_9', mode: 'payment', payment_status: 'paid', customer: 'cus_1', metadata: { ownerType: 'recruiter', ownerId: 'r1', kind: 'credit_pack', packs: '1' } }), { stripe: {}, now });
    assert.strictEqual(rec.billing.testCreditsPurchased, 3);
  });
  await t('webhook: the slots subscription sets the slot count and never touches the membership', async () => {
    await webhook.handleEvent(ev('w2', 'customer.subscription.updated', slotSub({})), { stripe: {}, now });
    assert.strictEqual(rec.billing.slots.quantity, 4); assert.strictEqual(rec.billing.slots.status, 'active');
    assert.strictEqual(rec.billing.subscriptionId, 'sub_main'); assert.strictEqual(rec.billing.status, 'active');
    // a failed slot invoice must not put the membership into grace
    await webhook.handleEvent(ev('w3', 'invoice.payment_failed', { subscription: 'sub_slot', customer: 'cus_1' }), { stripe: {}, now });
    assert.strictEqual(rec.billing.status, 'active'); assert.strictEqual(rec.billing.graceUntil || null, null);
    await webhook.handleEvent(ev('w4', 'customer.subscription.deleted', slotSub({ status: 'canceled' })), { stripe: {}, now });
    assert.strictEqual(rec.billing.slots.quantity, 0);
    assert.deepStrictEqual(sentEmails, []); // buying add-ons never sends a "welcome" or any membership email
  });
  await t('webhook: when the membership ends, the paid slots add-on is cancelled too', async () => {
    rec.billing.slots = { status: 'active', quantity: 2, subscriptionId: 'sub_slot', itemId: 'si_9' };
    let cancelled = null;
    const stripe = { subscriptions: { cancel: async (id) => { cancelled = id; } } };
    await webhook.handleEvent(ev('w5', 'customer.subscription.deleted', { id: 'sub_main', customer: 'cus_1', status: 'canceled', cancel_at_period_end: false, items: { data: [] }, metadata: { ownerType: 'recruiter', ownerId: 'r1' } }), { stripe, now });
    assert.strictEqual(rec.billing.status, 'canceled'); assert.strictEqual(cancelled, 'sub_slot');
    assert.deepStrictEqual(sentEmails, ['Your PreCheckd membership has ended']);
  });

  // ---- spending credits
  await t('credits: the monthly allowance is spent first, then bought credits, and a released request gives its credit back', async () => {
    process.env.TEST_CREDITS_PER_MONTH = '3';
    const month = testRequests.monthOf();
    let rows = [];
    TestRequest.find = () => ({ then: (f) => f([]), sort: async () => [] }); // expireOverdue finds nothing
    TestRequest.countDocuments = async (q) => rows.filter((r) => r.recruiterId === 'r9' && (!q.month || r.month === q.month) && q.status.$in.includes(r.status)
      && (q.paidCredit === true ? r.paidCredit === true : q.paidCredit ? !r.paidCredit : true)).length;
    const r = { _id: 'r9', billing: { testCreditsPurchased: 3 }, testCreditBonus: {} };
    let c = await testRequests.credits(r);
    assert.deepStrictEqual([c.left, c.monthlyLeft, c.boughtLeft, c.total], [6, 3, 3, 6]);
    rows = [{ recruiterId: 'r9', month, status: 'sent', paidCredit: false }, { recruiterId: 'r9', month, status: 'sent', paidCredit: false }, { recruiterId: 'r9', month, status: 'completed', paidCredit: false }];
    c = await testRequests.credits(r);
    assert.deepStrictEqual([c.left, c.monthlyLeft, c.boughtLeft], [3, 0, 3]); // allowance gone, bought untouched
    rows.push({ recruiterId: 'r9', month, status: 'sent', paidCredit: true });
    c = await testRequests.credits(r);
    assert.deepStrictEqual([c.left, c.boughtLeft, c.used, c.total], [2, 2, 4, 6]);
    rows[3].status = 'declined'; // released: the bought credit returns
    c = await testRequests.credits(r);
    assert.strictEqual(c.boughtLeft, 3);
    // last month's bought credit that was spent stays spent; next month the allowance refills
    rows = [{ recruiterId: 'r9', month: '2026-10', status: 'completed', paidCredit: true }];
    c = await testRequests.credits(r);
    assert.deepStrictEqual([c.monthlyLeft, c.boughtLeft], [3, 2]);
  });

  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
