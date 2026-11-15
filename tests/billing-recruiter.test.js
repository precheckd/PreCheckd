// Run: node tests/billing-recruiter.test.js
// Recruiter plans, founding waves, Stripe sync, webhook idempotency, checkout request. Stripe and the database are stubbed.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.BILLING_ENABLED = 'true';
const assert = require('assert');
const plans = require('../src/services/billingPlans');
const sync = require('../src/services/billingSync');
const membership = require('../src/services/membership');
const BillingEvent = require('../src/models/BillingEvent');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const webhook = require('../src/services/billingWebhook');
const recruiterBilling = require('../src/services/recruiterBilling');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const DAY = 86400000;
const now = new Date('2026-11-14T12:00:00Z');
const secs = (d) => Math.floor(d.getTime() / 1000);

(async () => {
  await t('waves: first 100 at $249, next 150 at $349, then regular $499', async () => {
    assert.deepStrictEqual(plans.waveStatus({}), { wave: 1, plan: 'founding_1', priceCents: 24900, spotsLeft: 100, size: 100 });
    assert.strictEqual(plans.waveStatus({ 1: 99 }).spotsLeft, 1);
    const w2 = plans.waveStatus({ 1: 100, 2: 10 });
    assert.strictEqual(w2.wave, 2); assert.strictEqual(w2.priceCents, 34900); assert.strictEqual(w2.spotsLeft, 140);
    const over = plans.waveStatus({ 1: 100, 2: 150 });
    assert.strictEqual(over.wave, null); assert.strictEqual(over.priceCents, 49900);
  });
  await t('plan choice: monthly is always $59; founding is annual only and once per person', async () => {
    const st = plans.waveStatus({});
    assert.deepStrictEqual(plans.choosePlan({ interval: 'monthly', status: st, hadFounding: false }), { plan: 'recruiter_monthly', wave: null });
    assert.deepStrictEqual(plans.choosePlan({ interval: 'annual', status: st, hadFounding: false }), { plan: 'founding_1', wave: 1 });
    assert.deepStrictEqual(plans.choosePlan({ interval: 'annual', status: st, hadFounding: true }), { plan: 'recruiter_annual', wave: null });
    assert.strictEqual(plans.choosePlan({ interval: 'weekly', status: st, hadFounding: false }), null);
  });
  await t('prices are found by lookup key and only created when missing', async () => {
    plans.clearCache();
    const created = [];
    const stripe = { prices: {
      list: async ({ lookup_keys }) => ({ data: lookup_keys[0] === 'precheckd_recruiter_monthly' ? [{ id: 'price_old' }] : [] }),
      create: async (p) => { created.push(p); return { id: 'price_new_' + p.lookup_key }; } } };
    assert.strictEqual(await plans.ensurePrice(stripe, 'recruiter_monthly'), 'price_old');
    assert.strictEqual(await plans.ensurePrice(stripe, 'recruiter_annual'), 'price_new_precheckd_recruiter_annual');
    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0].unit_amount, 49900); assert.strictEqual(created[0].recurring.interval, 'year'); assert.strictEqual(created[0].tax_behavior, 'exclusive');
    await plans.ensurePrice(stripe, 'recruiter_annual');
    assert.strictEqual(created.length, 1);
  });

  await t('sync: active, past_due grace starts once and never extends, canceled rules', async () => {
    const sub = (o) => Object.assign({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
      current_period_end: secs(new Date(now.getTime() + 30 * DAY)), items: { data: [{ price: { recurring: { interval: 'month' } } }] } }, o);
    const b = { founding: { wave: 1, lockedAt: null } };
    sync.applySubscription(b, sub({}), now);
    assert.strictEqual(b.status, 'active'); assert.strictEqual(b.plan, 'monthly'); assert.ok(b.founding.lockedAt);
    sync.applySubscription(b, sub({ status: 'past_due' }), now);
    const first = b.graceUntil.getTime();
    assert.strictEqual(first, now.getTime() + 14 * DAY);
    sync.applySubscription(b, sub({ status: 'past_due' }), new Date(now.getTime() + 5 * DAY));
    assert.strictEqual(b.graceUntil.getTime(), first);
    sync.applySubscription(b, sub({ status: 'active' }), now);
    assert.strictEqual(b.graceUntil, null);
    sync.applySubscription(b, sub({ status: 'canceled', cancel_at_period_end: true }), now);
    assert.strictEqual(b.status, 'canceled'); assert.ok(b.currentPeriodEnd.getTime() > now.getTime());
    sync.applySubscription(b, sub({ status: 'canceled', cancel_at_period_end: false }), now);
    assert.strictEqual(b.currentPeriodEnd.getTime(), now.getTime());
  });

  // ---- webhook, with a fake store
  const events = new Map();
  BillingEvent.create = async (d) => { if (events.has(d.eventId)) { const e = new Error('dup'); e.code = 11000; throw e; } events.set(d.eventId, d); return d; };
  BillingEvent.updateOne = async (q, u) => { Object.assign(events.get(q.eventId) || {}, u.$set); };
  BillingEvent.deleteOne = async (q) => { events.delete(q.eventId); };
  const rec = { _id: 'r1', billing: { customerId: 'cus_1', status: 'none', founding: { wave: null } }, saves: 0, save: async function () { this.saves++; } };
  Recruiter.findById = async (id) => (id === 'r1' ? rec : null);
  Recruiter.findOne = async (q) => (q['billing.customerId'] === 'cus_1' ? rec : null);
  Candidate.findOne = async () => null; Candidate.findById = async () => null;
  const subObj = { id: 'sub_9', customer: 'cus_1', status: 'active', cancel_at_period_end: false, current_period_end: secs(new Date(now.getTime() + 365 * DAY)),
    items: { data: [{ price: { recurring: { interval: 'year' } } }] }, metadata: { ownerType: 'recruiter', ownerId: 'r1' } };
  const stripe = { subscriptions: { retrieve: async () => subObj } };

  await t('webhook: checkout completed makes the recruiter active; a repeat of the same event is skipped', async () => {
    const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_9', customer: 'cus_1', metadata: { ownerType: 'recruiter', ownerId: 'r1' } } } };
    const a = await webhook.handleEvent(ev, { stripe, now });
    assert.strictEqual(a.handled, true); assert.strictEqual(rec.billing.status, 'active'); assert.strictEqual(rec.billing.plan, 'annual');
    const b = await webhook.handleEvent(ev, { stripe, now });
    assert.strictEqual(b.duplicate, true); assert.strictEqual(rec.saves, 1);
  });
  await t('webhook: payment failed starts grace; invoice paid clears it', async () => {
    await webhook.handleEvent({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_9', customer: 'cus_1' } } }, { stripe, now });
    assert.strictEqual(rec.billing.status, 'past_due'); assert.ok(rec.billing.graceUntil);
    assert.strictEqual(membership.state(rec, now).status, 'grace');
    await webhook.handleEvent({ id: 'evt_3', type: 'invoice.paid', data: { object: { subscription: 'sub_9', customer: 'cus_1', lines: { data: [{ period: { end: secs(new Date(now.getTime() + 30 * DAY)) } }] } } } }, { stripe, now });
    assert.strictEqual(rec.billing.status, 'active'); assert.strictEqual(rec.billing.graceUntil, null);
  });
  await t('webhook: invoice events work with the newer Stripe layout (subscription under invoice.parent)', async () => {
    const newer = (id, type, extra) => ({ id, type, data: { object: Object.assign({ customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_9' } } }, extra) } });
    await webhook.handleEvent(newer('evt_n1', 'invoice.payment_failed', {}), { stripe, now });
    assert.strictEqual(rec.billing.status, 'past_due');
    await webhook.handleEvent(newer('evt_n2', 'invoice.paid', { lines: { data: [{ period: { end: secs(new Date(now.getTime() + 30 * DAY)) } }] } }), { stripe, now });
    assert.strictEqual(rec.billing.status, 'active');
    // and a one-off invoice with no subscription is still ignored
    const r = await webhook.handleEvent({ id: 'evt_n3', type: 'invoice.paid', data: { object: { customer: 'cus_1' } } }, { stripe, now });
    assert.strictEqual(r.handled, true); assert.strictEqual(events.get('evt_n3').note, 'not a subscription invoice');
  });
  await t('webhook: a failure inside the handler lets Stripe retry (the event is forgotten)', async () => {
    const bad = { subscriptions: { retrieve: async () => { throw new Error('stripe down'); } } };
    const ev = { id: 'evt_4', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_9', customer: 'cus_1', metadata: {} } } };
    await assert.rejects(webhook.handleEvent(ev, { stripe: bad, now }), /stripe down/);
    assert.strictEqual(events.has('evt_4'), false);
  });
  await t('webhook: events we do not use are ignored without being recorded', async () => {
    const r = await webhook.handleEvent({ id: 'evt_5', type: 'charge.succeeded', data: { object: {} } }, { stripe, now });
    assert.strictEqual(r.handled, false); assert.strictEqual(events.has('evt_5'), false);
  });

  // ---- checkout request
  await t('checkout: subscription mode, automatic tax, founding spot held for 35 minutes', async () => {
    plans.clearCache();
    Recruiter.countDocuments = async () => 0;
    const r = { _id: 'r2', email: 'a@co.com', firstName: 'A', lastName: 'B', billing: { status: 'none', customerId: null, founding: {} }, save: async function () {} };
    let args = null;
    const st = { customers: { create: async (c) => { assert.strictEqual(c.metadata.ownerId, 'r2'); return { id: 'cus_new' }; } },
      prices: { list: async () => ({ data: [{ id: 'price_f1' }] }) },
      checkout: { sessions: { create: async (a) => { args = a; return { url: 'https://stripe.test/pay' }; } } } };
    const out = await recruiterBilling.startCheckout({ stripe: st, recruiter: r, interval: 'annual', baseUrl: 'https://precheckd.com', successPath: '/billing/return', cancelPath: '/billing?canceled=1', now });
    assert.strictEqual(out.url, 'https://stripe.test/pay'); assert.strictEqual(out.wave, 1);
    assert.strictEqual(args.mode, 'subscription'); assert.deepStrictEqual(args.automatic_tax, { enabled: true });
    assert.strictEqual(args.client_reference_id, 'r2'); assert.strictEqual(args.subscription_data.metadata.ownerId, 'r2');
    assert.ok(args.success_url.endsWith('/billing/return?session_id={CHECKOUT_SESSION_ID}'));
    assert.strictEqual(r.billing.founding.wave, 1); assert.strictEqual(r.billing.founding.priceCents, 24900); assert.ok(r.billing.founding.reservedAt);
    assert.strictEqual(r.billing.customerId, 'cus_new');
  });
  await t('checkout: someone who already pays cannot start a second subscription', async () => {
    const r = { _id: 'r3', billing: { status: 'active', founding: {} }, save: async () => {} };
    await assert.rejects(recruiterBilling.startCheckout({ stripe: {}, recruiter: r, interval: 'monthly', baseUrl: '', successPath: '/x', cancelPath: '/y', now }), (e) => e.code === 'already_active');
  });
  await t('return from Checkout: refuses someone else\'s session; unpaid session changes nothing', async () => {
    const r = { _id: 'r4', billing: { status: 'incomplete', founding: {} }, save: async () => {} };
    const st = (s) => ({ checkout: { sessions: { retrieve: async () => s } }, subscriptions: { retrieve: async () => subObj } });
    await assert.rejects(recruiterBilling.confirmReturn({ stripe: st({ client_reference_id: 'other', mode: 'subscription', subscription: 's', payment_status: 'paid' }), recruiter: r, sessionId: 'cs_1', now }), (e) => e.code === 'mismatch');
    const unpaid = await recruiterBilling.confirmReturn({ stripe: st({ client_reference_id: 'r4', mode: 'subscription', subscription: 's', payment_status: 'unpaid' }), recruiter: r, sessionId: 'cs_1', now });
    assert.strictEqual(unpaid.paid, false); assert.strictEqual(r.billing.status, 'incomplete');
    const paid = await recruiterBilling.confirmReturn({ stripe: st({ client_reference_id: 'r4', mode: 'subscription', subscription: 's', payment_status: 'paid' }), recruiter: r, sessionId: 'cs_1', now });
    assert.strictEqual(paid.paid, true); assert.strictEqual(r.billing.status, 'active');
  });

  await t('5 open postings in the plan; bought slots add to it', async () => {
    assert.strictEqual(membership.openLimit({ billing: {} }), 5);
    assert.strictEqual(membership.openLimit({ billing: { slots: { status: 'active', quantity: 3 } } }), 8);
    assert.strictEqual(membership.openLimit({ billing: { slots: { status: 'canceled', quantity: 3 } } }), 5);
  });
  await t('postings of a lapsed recruiter are hidden; billing off hides nothing', async () => {
    Recruiter.find = () => ({ select: async () => [
      { _id: 'a', billing: { status: 'active' } }, { _id: 'b', billing: { status: 'canceled', currentPeriodEnd: new Date(now.getTime() - DAY) } }] });
    const list = [{ recruiterId: 'a' }, { recruiterId: 'b' }];
    assert.deepStrictEqual((await membership.visiblePostings(list)).map((p) => p.recruiterId), ['a']);
    process.env.BILLING_ENABLED = 'false';
    assert.strictEqual((await membership.visiblePostings(list)).length, 2);
    process.env.BILLING_ENABLED = 'true';
  });

  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
