// Recruiter add-ons: extra open-posting slots (a separate monthly subscription, graduated price) and job-title
// test-credit packs (one-time payment). Both need an active membership.
const plans = require('./billingPlans');
const membership = require('./membership');
const sync = require('./billingSync');

const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
const whole = (v) => Math.floor(Number(v));

function needMember(recruiter) {
  if (!membership.isMember(recruiter)) throw err('not_member', 'Start your membership first.');
}

// Stripe subscription -> our slots block. Only the quantity on the slot price counts.
function applySlotSubscription(billing, sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  billing.slots = {
    subscriptionId: sub.id,
    itemId: item ? item.id : (billing.slots && billing.slots.itemId) || null,
    quantity: sub.status === 'canceled' || sub.status === 'incomplete_expired' ? 0 : (item && Number(item.quantity)) || 0,
    status: sync.mapStatus(sub.status),
  };
  return billing.slots;
}

// ---- slots -----------------------------------------------------------------------------------------------
// First purchase goes through Checkout. Later changes update the subscription directly. `openCount` is how many
// postings are open now: nobody can drop below what they are using.
async function setSlots({ stripe, recruiter, quantity, openCount = 0, baseUrl, now = new Date() }) {
  needMember(recruiter);
  const qty = whole(quantity);
  if (!(qty >= 0 && qty <= plans.MAX_EXTRA_SLOTS)) throw err('bad_quantity', `Choose 0 to ${plans.MAX_EXTRA_SLOTS} extra slots.`);
  if (plans.BASE_OPEN_POSTINGS + qty < openCount) throw err('in_use', 'Close some postings first: you have more open than that.');
  const slots = recruiter.billing.slots || {};
  const live = slots.subscriptionId && (slots.status === 'active' || slots.status === 'past_due');

  if (live) {
    if (qty === 0) {
      const sub = await stripe.subscriptions.update(slots.subscriptionId, { cancel_at_period_end: true });
      return { updated: true, sub };
    }
    const sub = await stripe.subscriptions.update(slots.subscriptionId, {
      items: [{ id: slots.itemId, quantity: qty }], proration_behavior: 'create_prorations', cancel_at_period_end: false,
    });
    applySlotSubscription(recruiter.billing, sub);
    await recruiter.save();
    return { updated: true, sub };
  }
  if (qty === 0) throw err('bad_quantity', 'Choose at least 1 slot.');
  const priceId = await plans.ensurePrice(stripe, 'recruiter_slot');
  const owner = { ownerType: 'recruiter', ownerId: String(recruiter._id), kind: 'slots' };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer: recruiter.billing.customerId, client_reference_id: String(recruiter._id),
    line_items: [{ price: priceId, quantity: qty }],
    automatic_tax: { enabled: true }, billing_address_collection: 'required', customer_update: { address: 'auto', name: 'auto' },
    metadata: owner, subscription_data: { metadata: owner },
    success_url: `${baseUrl}/billing/addon-return?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${baseUrl}/billing?canceled=1`,
  });
  return { url: session.url };
}

// ---- credit packs ----------------------------------------------------------------------------------------
async function startPackCheckout({ stripe, recruiter, packs, baseUrl }) {
  needMember(recruiter);
  const n = whole(packs);
  if (!(n >= 1 && n <= plans.MAX_PACKS_AT_ONCE)) throw err('bad_quantity', `Choose 1 to ${plans.MAX_PACKS_AT_ONCE} packs.`);
  const priceId = await plans.ensurePrice(stripe, 'recruiter_credit_pack');
  const meta = { ownerType: 'recruiter', ownerId: String(recruiter._id), kind: 'credit_pack', packs: String(n) };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', customer: recruiter.billing.customerId, client_reference_id: String(recruiter._id),
    line_items: [{ price: priceId, quantity: n }],
    automatic_tax: { enabled: true }, billing_address_collection: 'required', customer_update: { address: 'auto', name: 'auto' },
    metadata: meta,
    success_url: `${baseUrl}/billing/addon-return?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${baseUrl}/billing?canceled=1`,
  });
  return { url: session.url };
}

// Turns a paid pack session into credits, once. Returns true if credits were added now.
function fulfillPack(recruiter, session) {
  if (!session || session.payment_status !== 'paid' || !session.metadata || session.metadata.kind !== 'credit_pack') return false;
  const b = recruiter.billing;
  if ((b.fulfilledSessions || []).includes(session.id)) return false;
  const packs = Math.max(0, Math.min(plans.MAX_PACKS_AT_ONCE, whole(session.metadata.packs) || 0));
  b.testCreditsPurchased = (b.testCreditsPurchased || 0) + packs * plans.CREDITS_PER_PACK;
  b.fulfilledSessions = [...(b.fulfilledSessions || []), session.id].slice(-25);
  return true;
}

// Back from Checkout (either kind): do not wait for the webhook.
async function confirmReturn({ stripe, recruiter, sessionId }) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session || session.client_reference_id !== String(recruiter._id)) throw err('mismatch', 'That payment is not yours.');
  const kind = session.metadata && session.metadata.kind;
  if (kind === 'credit_pack') {
    const added = fulfillPack(recruiter, session);
    if (added) await recruiter.save();
    return { kind, done: session.payment_status === 'paid' };
  }
  if (kind === 'slots' && session.subscription && session.payment_status === 'paid') {
    const subId = typeof session.subscription === 'object' ? session.subscription.id : session.subscription;
    applySlotSubscription(recruiter.billing, await stripe.subscriptions.retrieve(subId));
    await recruiter.save();
    return { kind, done: true };
  }
  return { kind, done: false };
}

module.exports = { applySlotSubscription, setSlots, startPackCheckout, fulfillPack, confirmReturn };
