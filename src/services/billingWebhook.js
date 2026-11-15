// Stripe webhook events -> billing state. Idempotent: every event id is recorded, and a repeat is skipped.
const BillingEvent = require('../models/BillingEvent');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const sync = require('./billingSync');

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

const MODELS = { recruiter: Recruiter, candidate: Candidate };

// Finds the account an event is about: by the owner we stamped on the subscription/session, else by customer id.
async function findOwner(meta, customerId) {
  if (meta && meta.ownerType && meta.ownerId && MODELS[meta.ownerType]) {
    const doc = await MODELS[meta.ownerType].findById(meta.ownerId);
    if (doc) return { type: meta.ownerType, doc };
  }
  if (customerId) {
    for (const type of Object.keys(MODELS)) {
      const doc = await MODELS[type].findOne({ 'billing.customerId': customerId });
      if (doc) return { type, doc };
    }
  }
  return null;
}

// Newer Stripe API versions moved the subscription off the invoice root into invoice.parent.subscription_details.
function invoiceSubscriptionId(inv) {
  const direct = inv && inv.subscription;
  const nested = inv && inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription;
  const v = direct || nested;
  return (v && typeof v === 'object' ? v.id : v) || null;
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;

async function apply(event, { stripe, now }) {
  const obj = event.data.object;
  let owner = null;

  if (event.type === 'checkout.session.completed') {
    if (obj.mode !== 'subscription' || !obj.subscription) return { note: 'not a subscription checkout' };
    owner = await findOwner(obj.metadata, idOf(obj.customer));
    if (!owner) return { note: 'no owner' };
    const sub = await stripe.subscriptions.retrieve(idOf(obj.subscription));
    sync.applySubscription(owner.doc.billing, sub, now);
  } else if (event.type.startsWith('customer.subscription.')) {
    owner = await findOwner(obj.metadata, idOf(obj.customer));
    if (!owner) return { note: 'no owner' };
    // A stale event for an old subscription must not overwrite a newer one.
    const current = owner.doc.billing.subscriptionId;
    if (current && current !== obj.id && owner.doc.billing.status !== 'canceled' && owner.doc.billing.status !== 'none') return { note: 'stale subscription' };
    sync.applySubscription(owner.doc.billing, obj, now);
  } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    if (!invoiceSubscriptionId(obj)) return { note: 'not a subscription invoice' };
    owner = await findOwner(null, idOf(obj.customer));
    if (!owner) return { note: 'no owner' };
    if (event.type === 'invoice.paid') sync.applyPaid(owner.doc.billing, obj);
    else sync.applyPaymentFailed(owner.doc.billing, now);
  }

  if (!owner) return { note: 'ignored' };
  await owner.doc.save();
  return { ownerType: owner.type, ownerId: owner.doc._id };
}

// Returns { handled, duplicate }. Throws if processing failed, so Stripe retries the event.
async function handleEvent(event, { stripe, now = new Date() } = {}) {
  if (!HANDLED.has(event.type)) return { handled: false, duplicate: false };
  try {
    await BillingEvent.create({ eventId: event.id, type: event.type });
  } catch (e) {
    if (e && e.code === 11000) return { handled: false, duplicate: true };
    throw e;
  }
  try {
    const out = await apply(event, { stripe, now });
    await BillingEvent.updateOne({ eventId: event.id }, { $set: { ownerType: out.ownerType || null, ownerId: out.ownerId || null, note: out.note || null } });
    return { handled: true, duplicate: false };
  } catch (e) {
    // Let the retry through: forget we saw it.
    try { await BillingEvent.deleteOne({ eventId: event.id }); } catch (_) { /* best effort */ }
    throw e;
  }
}

module.exports = { handleEvent, HANDLED, invoiceSubscriptionId };
