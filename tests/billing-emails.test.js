// Run: node tests/billing-emails.test.js
// The membership emails: which status changes send one, what they say, and that a failed send never fails the webhook.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.BILLING_ENABLED = 'true';
process.env.MOCK_EMAIL = 'true';
const assert = require('assert');
const emailService = require('../src/services/emailService');
const be = require('../src/services/billingEmails');
const BillingEvent = require('../src/models/BillingEvent');
const Recruiter = require('../src/models/Recruiter');
const Candidate = require('../src/models/Candidate');
const webhook = require('../src/services/billingWebhook');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const DAY = 86400000;
const now = new Date('2026-11-14T12:00:00Z');
const secs = (d) => Math.floor(d.getTime() / 1000);
const st = (status, cancel) => ({ status, cancelAtPeriodEnd: Boolean(cancel) });

(async () => {
  await t('which changes send an email', async () => {
    assert.deepStrictEqual(be.transitions(st('none'), st('active')), ['started']);
    assert.deepStrictEqual(be.transitions(st('incomplete'), st('active')), ['started']);
    assert.deepStrictEqual(be.transitions(st('active'), st('active')), []);
    assert.deepStrictEqual(be.transitions(st('active'), st('past_due')), ['payment_trouble']);
    assert.deepStrictEqual(be.transitions(st('past_due'), st('past_due')), []);
    assert.deepStrictEqual(be.transitions(st('past_due'), st('active')), []);
    assert.deepStrictEqual(be.transitions(st('active', false), st('active', true)), ['cancel_scheduled']);
    assert.deepStrictEqual(be.transitions(st('active'), st('canceled')), ['ended']);
    assert.deepStrictEqual(be.transitions(st('canceled'), st('canceled')), []);
  });
  await t('the words: payment trouble names the date access ends; recruiter and candidate copy differ', async () => {
    const r = be.notice('payment_trouble', 'recruiter', { graceUntil: new Date('2026-11-28T12:00:00Z') });
    assert.ok(r.paragraphs[0].includes('November 28, 2026')); assert.ok(r.url.endsWith('/billing'));
    assert.ok(r.paragraphs[0].includes('post jobs'));
    const c = be.notice('payment_trouble', 'candidate', { graceUntil: new Date('2026-11-28T12:00:00Z') });
    assert.ok(c.url.endsWith('/candidate-billing')); assert.ok(c.paragraphs[0].includes('take skill tests'));
    assert.ok(be.notice('ended', 'candidate').paragraphs[0].includes('not a member'));
    assert.ok(be.notice('ended', 'recruiter').paragraphs[0].includes('hidden'));
    assert.ok(be.notice('cancel_scheduled', 'recruiter', { periodEnd: new Date('2027-01-05T12:00:00Z') }).paragraphs[0].includes('January 5, 2027'));
    assert.strictEqual(be.notice('nope', 'recruiter'), null);
  });

  // ---- through the webhook
  const sent = [];
  emailService.sendBillingNoticeEmail = async (to, first, notice) => { sent.push({ to, subject: notice.subject }); };
  const events = new Map();
  BillingEvent.create = async (d) => { if (events.has(d.eventId)) { const e = new Error('dup'); e.code = 11000; throw e; } events.set(d.eventId, d); return d; };
  BillingEvent.updateOne = async () => {}; BillingEvent.deleteOne = async (q) => { events.delete(q.eventId); };
  const rec = { _id: 'r1', email: 'r@co.com', firstName: 'Rae', billing: { customerId: 'cus_1', status: 'none', founding: {} }, save: async () => {} };
  Recruiter.findById = async (id) => (id === 'r1' ? rec : null); Recruiter.findOne = async (q) => (q['billing.customerId'] === 'cus_1' ? rec : null);
  Candidate.findOne = async () => null; Candidate.findById = async () => null;
  const sub = (o) => Object.assign({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, current_period_end: secs(new Date(now.getTime() + 30 * DAY)),
    items: { data: [{ price: { recurring: { interval: 'month' } } }] }, metadata: { ownerType: 'recruiter', ownerId: 'r1' } }, o);
  const stripe = { subscriptions: { retrieve: async () => sub({}) } };
  const ev = (id, type, object) => ({ id, type, data: { object } });

  await t('webhook: first payment sends "started" once; later events with no change send nothing', async () => {
    await webhook.handleEvent(ev('e1', 'checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', metadata: { ownerType: 'recruiter', ownerId: 'r1' } }), { stripe, now });
    assert.strictEqual(sent.length, 1); assert.ok(/active/.test(sent[0].subject));
    await webhook.handleEvent(ev('e2', 'customer.subscription.updated', sub({})), { stripe, now });
    assert.strictEqual(sent.length, 1);
  });
  await t('webhook: payment failure, then scheduled cancel, then end', async () => {
    await webhook.handleEvent(ev('e3', 'invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1' }), { stripe, now });
    assert.strictEqual(sent.length, 2); assert.ok(/did not go through/.test(sent[1].subject));
    await webhook.handleEvent(ev('e4', 'invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1' }), { stripe, now });
    assert.strictEqual(sent.length, 2); // a second failure while already in trouble is not a second email
    await webhook.handleEvent(ev('e5', 'invoice.paid', { subscription: 'sub_1', customer: 'cus_1', lines: { data: [] } }), { stripe, now });
    await webhook.handleEvent(ev('e6', 'customer.subscription.updated', sub({ cancel_at_period_end: true })), { stripe, now });
    assert.strictEqual(sent.length, 3); assert.ok(/will end/.test(sent[2].subject));
    await webhook.handleEvent(ev('e7', 'customer.subscription.deleted', sub({ status: 'canceled', cancel_at_period_end: true })), { stripe, now });
    assert.strictEqual(sent.length, 4); assert.ok(/has ended/.test(sent[3].subject));
  });
  await t('a failing email provider never fails the webhook', async () => {
    emailService.sendBillingNoticeEmail = async () => { throw new Error('resend down'); };
    rec.billing.status = 'none';
    const out = await webhook.handleEvent(ev('e8', 'customer.subscription.updated', sub({})), { stripe, now });
    assert.strictEqual(out.handled, true); assert.strictEqual(rec.billing.status, 'active');
  });

  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
