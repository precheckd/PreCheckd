// Run: node tests/free-year.test.js
// The invite-only free founding year: codes, the bar (evaluate), the nightly check, and the trial checkout. Stripe and the database are stubbed.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.BILLING_ENABLED = 'true';
const assert = require('assert');
const invites = require('../src/services/foundingInvites');
const freeYear = require('../src/services/freeYear');
const recruiterBilling = require('../src/services/recruiterBilling');
const FoundingInvite = require('../src/models/FoundingInvite');
const Recruiter = require('../src/models/Recruiter');
const JobPosting = require('../src/models/JobPosting');
const emailService = require('../src/services/emailService');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const DAY = 86400000;
const start = new Date('2026-12-01T12:00:00Z');
const at = (days) => new Date(start.getTime() + days * DAY);
const fy = (o) => Object.assign({ status: 'ok', startedAt: start, trialEnd: at(365), postedMetAt: null, warnedAt: null, cureBy: null, reminderSentAt: null }, o);

(async () => {
  await t('codes: 8 characters, no look-alike letters, typed codes are cleaned', async () => {
    for (let i = 0; i < 200; i++) { const c = invites.generateCode(); assert.strictEqual(c.length, 8); assert.ok(!/[01OIL]/.test(c)); assert.strictEqual(invites.cleanCode(c.toLowerCase()), c); }
    assert.strictEqual(invites.cleanCode('abc'), ''); assert.strictEqual(invites.cleanCode('0O1IL0O1'), ''); assert.strictEqual(invites.cleanCode(null), '');
    assert.strictEqual(invites.cleanCode('k7m2-qx9p'), 'K7M2QX9P');
    assert.ok(invites.joinUrl('K7M2QX9P').endsWith('/join/K7M2QX9P'));
  });

  await t('the bar: nothing happens while they are on track', async () => {
    assert.strictEqual(freeYear.evaluate(fy({}), { posted: 0, maintained: 0 }, at(10)).action, 'none'); // inside the first 30 days
    assert.strictEqual(freeYear.evaluate(fy({}), { posted: 3, maintained: 3 }, at(40)).action, 'none');
    const met = freeYear.evaluate(fy({}), { posted: 3, maintained: 3 }, at(5));
    assert.strictEqual(met.postedMet, true);
  });
  await t('the bar: fewer than 3 posted after 30 days warns; 3 posted but under 2 maintained warns', async () => {
    const a = freeYear.evaluate(fy({}), { posted: 2, maintained: 2 }, at(31));
    assert.strictEqual(a.action, 'warn'); assert.strictEqual(a.reason, 'posted');
    const b = freeYear.evaluate(fy({ postedMetAt: at(3) }), { posted: 3, maintained: 1 }, at(60));
    assert.strictEqual(b.action, 'warn'); assert.strictEqual(b.reason, 'maintained');
    // once the 3-jobs part is met it stays met, even if the postings later close
    assert.strictEqual(freeYear.evaluate(fy({ postedMetAt: at(3) }), { posted: 3, maintained: 2 }, at(90)).action, 'none');
  });
  await t('the bar: a job closed as filled counts toward maintained, so filling jobs is never punished', async () => {
    // the counts already include filled-in-the-last-30-days; evaluate only compares the totals
    assert.strictEqual(freeYear.evaluate(fy({ postedMetAt: at(3) }), { posted: 3, maintained: 2 }, at(50)).action, 'none');
  });
  await t('cure window: warned recruiters get a reminder a week before, are cleared when fixed, and are charged at the end', async () => {
    const warned = fy({ status: 'warned', postedMetAt: at(3), warnedAt: at(60), cureBy: at(90), reason: 'maintained' });
    const failing = { posted: 3, maintained: 0 };
    assert.strictEqual(freeYear.evaluate(warned, failing, at(70)).action, 'none');
    assert.strictEqual(freeYear.evaluate(warned, failing, at(84)).action, 'remind');
    assert.strictEqual(freeYear.evaluate(Object.assign({}, warned, { reminderSentAt: at(84) }), failing, at(85)).action, 'none');
    assert.strictEqual(freeYear.evaluate(warned, { posted: 4, maintained: 2 }, at(70)).action, 'clear');
    const end = freeYear.evaluate(warned, failing, at(90));
    assert.strictEqual(end.action, 'end'); assert.strictEqual(end.reason, 'maintained');
  });
  await t('the year simply ends after 365 days, and ended or missing free years are left alone', async () => {
    assert.strictEqual(freeYear.evaluate(fy({}), { posted: 0, maintained: 0 }, at(366)).action, 'complete');
    assert.strictEqual(freeYear.evaluate(fy({ status: 'ended' }), { posted: 0, maintained: 0 }, at(100)).action, 'none');
    assert.strictEqual(freeYear.evaluate(null, {}, at(1)).action, 'none');
  });

  await t('emails: every kind has words, a button and a link, and none promise more than the offer', async () => {
    for (const k of ['started', 'warning', 'reminder', 'back_on_track', 'ended_bar']) {
      const m = freeYear.notice(k, { reason: 'posted', cureBy: at(90), trialEnd: at(365) });
      assert.ok(m.subject && m.headline && m.paragraphs.length && m.button && /^https?:\/\//.test(m.url), k);
    }
    assert.ok(/\$349/.test(freeYear.notice('warning', { reason: 'posted', cureBy: at(90) }).paragraphs.join(' ')));
    assert.ok(/30 days/.test(freeYear.notice('started', {}).paragraphs.join(' ')));
  });

  // ---- the nightly check, with a fake store
  const sent = [];
  emailService.sendBillingNoticeEmail = async (to, name, notice) => { sent.push(notice.subject); };
  function recruiter(over) {
    return { _id: 'r' + Math.random(), email: 'r@co.com', firstName: 'R', billing: { status: 'active', subscriptionId: 'sub_1', freeYear: fy(over) }, saves: 0,
      markModified() {}, save: async function () { this.saves++; } };
  }
  let counts = { posted: 3, open: 0, filled: 0 };
  function stubCounts(c) {
    JobPosting.countDocuments = async (q) => (q.status === 'closed' ? c.filled : c.posted);
    JobPosting.find = async () => Array.from({ length: c.open }, () => ({ status: 'open', closeDate: new Date('2030-01-01T00:00:00Z') }));
  }
  await t('the check warns, then charges the card early only when the cure window runs out', async () => {
    const r = recruiter({ postedMetAt: at(3) });
    Recruiter.find = async () => [r];
    const updates = [];
    const stripe = { subscriptions: { update: async (id, body) => { updates.push([id, body]); } } };
    stubCounts({ posted: 3, open: 1, filled: 0 });
    let s = await freeYear.runFreeYearCheck({ stripe, now: at(60) });
    assert.strictEqual(s.warned, 1); assert.strictEqual(r.billing.freeYear.status, 'warned'); assert.strictEqual(r.billing.freeYear.cureBy.getTime(), at(90).getTime());
    assert.strictEqual(updates.length, 0); assert.ok(sent.includes('Action needed: your free founding year'));
    // running again the same day changes nothing and sends nothing more
    const before = sent.length; await freeYear.runFreeYearCheck({ stripe, now: at(60) }); assert.strictEqual(sent.length, before);
    // a week before the end: one reminder
    s = await freeYear.runFreeYearCheck({ stripe, now: at(84) }); assert.strictEqual(s.reminded, 1);
    // the cure window runs out: trial ends now so Stripe charges the first $349
    s = await freeYear.runFreeYearCheck({ stripe, now: at(91) });
    assert.strictEqual(s.ended, 1); assert.deepStrictEqual(updates, [['sub_1', { trial_end: 'now' }]]);
    assert.strictEqual(r.billing.freeYear.status, 'ended'); assert.strictEqual(r.billing.freeYear.endedReason, 'bar_missed');
    assert.ok(sent.includes('Your free founding year has ended'));
  });
  await t('the check clears a warning when they fix it, and does not charge', async () => {
    const r = recruiter({ status: 'warned', postedMetAt: at(3), warnedAt: at(60), cureBy: at(90), reason: 'maintained' });
    Recruiter.find = async () => [r];
    const updates = []; const stripe = { subscriptions: { update: async (id, body) => { updates.push(id); } } };
    stubCounts({ posted: 4, open: 2, filled: 0 });
    const s = await freeYear.runFreeYearCheck({ stripe, now: at(70) });
    assert.strictEqual(s.cleared, 1); assert.strictEqual(r.billing.freeYear.status, 'ok'); assert.strictEqual(r.billing.freeYear.cureBy, null); assert.strictEqual(updates.length, 0);
  });
  await t('if Stripe fails the free year is not marked ended, so the next run tries again', async () => {
    const r = recruiter({ status: 'warned', postedMetAt: at(3), warnedAt: at(60), cureBy: at(90), reason: 'maintained' });
    Recruiter.find = async () => [r];
    const stripe = { subscriptions: { update: async () => { throw new Error('stripe down'); } } };
    stubCounts({ posted: 3, open: 0, filled: 0 });
    const err = console.error; console.error = () => {};
    const s = await freeYear.runFreeYearCheck({ stripe, now: at(91) });
    console.error = err;
    assert.strictEqual(s.ended, 0); assert.strictEqual(r.billing.freeYear.status, 'warned');
  });
  await t('a recruiter who cancelled during the free year is simply closed out, with no emails or charge', async () => {
    const r = recruiter({}); r.billing.status = 'canceled';
    Recruiter.find = async () => [r];
    const before = sent.length;
    await freeYear.runFreeYearCheck({ stripe: { subscriptions: { update: async () => { throw new Error('must not be called'); } } }, now: at(10) });
    assert.strictEqual(r.billing.freeYear.status, 'ended'); assert.strictEqual(r.billing.freeYear.endedReason, 'not_active'); assert.strictEqual(sent.length, before);
  });
  await t('counts: open jobs that are still taking applications plus jobs filled in the last 30 days', async () => {
    stubCounts({ posted: 5, open: 2, filled: 1 });
    const c = await freeYear.countsFor({ _id: 'x', billing: { freeYear: fy({}) } }, at(40));
    assert.strictEqual(c.posted, 5); assert.strictEqual(c.maintained, 3);
  });

  // ---- checkout with an invite
  await t('invite checkout: annual $349 with a 365-day trial, card always collected, invite stamped on the session', async () => {
    require('../src/services/billingPlans').clearCache();
    Recruiter.countDocuments = async () => 0;
    const r = { _id: 'r9', email: 'a@co.com', firstName: 'A', billing: { status: 'none', customerId: 'cus_9', founding: {} }, save: async function () {} };
    let args = null;
    const st = { prices: { list: async () => ({ data: [{ id: 'price_349' }] }) }, checkout: { sessions: { create: async (a) => { args = a; return { url: 'https://stripe.test/trial' }; } } } };
    const out = await recruiterBilling.startCheckout({ stripe: st, recruiter: r, interval: 'monthly', invite: { _id: 'inv1' }, baseUrl: 'https://precheckd.com', successPath: '/billing/return', cancelPath: '/billing?canceled=1' });
    assert.strictEqual(out.wave, 1); assert.strictEqual(args.subscription_data.trial_period_days, 365); assert.strictEqual(args.payment_method_collection, 'always');
    assert.strictEqual(args.metadata.inviteId, 'inv1'); assert.strictEqual(args.subscription_data.metadata.inviteId, 'inv1');
    assert.strictEqual(args.line_items[0].price, 'price_349'); assert.strictEqual(r.billing.founding.wave, 1); assert.strictEqual(r.billing.founding.priceCents, 34900);
  });
  await t('invite checkout is refused when the 100 invite spots are gone', async () => {
    Recruiter.countDocuments = async (q) => (q['billing.founding.wave'] === 1 ? 100 : 0);
    const r = { _id: 'r10', billing: { status: 'none', customerId: 'cus_10', founding: {} }, save: async function () {} };
    await assert.rejects(() => recruiterBilling.startCheckout({ stripe: {}, recruiter: r, interval: 'annual', invite: { _id: 'inv2' }, baseUrl: 'x', successPath: '/a', cancelPath: '/b' }), (e) => e.code === 'invite_full');
  });
  await t('returning from a trial checkout (no payment yet) starts the free year and uses up the invite, once', async () => {
    const r = { _id: 'r11', email: 'a@co.com', firstName: 'A', billing: { status: 'incomplete', customerId: 'cus_11', founding: { wave: 1 } }, saves: 0, markModified() {}, save: async function () { this.saves++; } };
    const trialEnd = Math.floor(at(365).getTime() / 1000);
    const sub = { id: 'sub_t', customer: 'cus_11', status: 'trialing', trial_end: trialEnd, cancel_at_period_end: false, current_period_end: trialEnd, items: { data: [{ price: { recurring: { interval: 'year' } } }] } };
    const stripe = { checkout: { sessions: { retrieve: async () => ({ client_reference_id: 'r11', mode: 'subscription', subscription: 'sub_t', payment_status: 'no_payment_required', metadata: { inviteId: 'inv3' } }) } }, subscriptions: { retrieve: async () => sub } };
    const used = [];
    FoundingInvite.findOneAndUpdate = async (q, u) => { used.push(q._id); return { _id: q._id, status: 'redeemed' }; };
    FoundingInvite.findOne = async () => null;
    const out = await recruiterBilling.confirmReturn({ stripe, recruiter: r, sessionId: 'cs_1', now: start });
    assert.strictEqual(out.paid, true); assert.strictEqual(r.billing.status, 'active');
    assert.strictEqual(r.billing.freeYear.status, 'ok'); assert.strictEqual(r.billing.freeYear.trialEnd.getTime(), trialEnd * 1000); assert.strictEqual(used[0], 'inv3');
    assert.ok(sent.includes('Your free founding year has started'));
    // the webhook arriving afterwards does not start it a second time
    const before = sent.length;
    FoundingInvite.findOne = async () => ({ _id: 'inv3' });
    const again = await recruiterBilling.startFreeYearIfInvited(r, sub, { inviteId: 'inv3' }, start);
    assert.strictEqual(again, false); assert.strictEqual(sent.length, before);
  });

  console.log(n + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
