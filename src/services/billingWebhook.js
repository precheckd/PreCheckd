// Stripe webhook events -> billing state. Idempotent: every event id is recorded, and a repeat is skipped.
const BillingEvent = require('../models/BillingEvent');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const sync = require('./billingSync');
const billingEmails = require('./billingEmails');
const addons = require('./recruiterAddons');

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
  let before = { status: 'none', cancelAtPeriodEnd: false };
  const snap = () => { if (owner) before = billingEmails.stateOf(owner.doc.billing); };

  const kind = obj.metadata && obj.metadata.kind;
  if (event.type === 'checkout.session.completed' && kind === 'credit_pack') {
    owner = await findOwner(obj.metadata, idOf(obj.customer));
    if (!owner || owner.type !== 'recruiter') return { note: 'no owner' };
    snap();
    addons.fulfillPack(owner.doc, obj);
  } else if (event.type === 'checkout.session.completed' && kind === 'slots') {
    owner = await findOwner(obj.metadata, idOf(obj.customer));
    if (!owner || owner.type !== 'recruiter' || !obj.subscription) return { note: 'no owner' };
    snap();
    addons.applySlotSubscription(owner.doc.billing, await stripe.subscriptions.retrieve(idOf(obj.subscription)));
  } else if (event.type.startsWith('customer.subscription.') && obj.metadata && obj.metadata.kind === 'slots') {
    owner = await findOwner(obj.metadata, idOf(obj.customer));
    if (!owner || owner.type !== 'recruiter') return { note: 'no owner' };
    snap();
    addons.applySlotSubscription(owner.doc.billing, obj);
  } else if (event.type === 'checkout.session.completed') {
    if (obj.mode !== 'subscription' || !obj.subscription) return { note: 'not a subscription checkout' };
    owner = await findOwner(obj.metadata, idOf(obj.customer));
    if (!owner) return { note: 'no owner' };
    snap();
    const sub = await stripe.subscriptions.retrieve(idOf(obj.subscription));
    sync.applySubscription(owner.doc.billing, sub, now);
    // The $79 verification fee rides on a candidate's first checkout.
    if (owner.type === 'candidate' && obj.payment_status === 'paid') require('./candidateBilling').recordFee(owner.doc, obj.metadata, now);
  } else if (event.type.startsWith('customer.subscription.')) {
    owner = await findOwner(obj.metadata, idOf(obj.customer));
    if (!owner) return { note: 'no owner' };
    snap();
    // A stale event for an old subscription must not overwrite a newer one.
    const current = owner.doc.billing.subscriptionId;
    if (current && current !== obj.id && owner.doc.billing.status !== 'canceled' && owner.doc.billing.status !== 'none') return { note: 'stale subscription' };
    sync.applySubscription(owner.doc.billing, obj, now);
  } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    if (!invoiceSubscriptionId(obj)) return { note: 'not a subscription invoice' };
    owner = await findOwner(null, idOf(obj.customer));
    if (!owner) return { note: 'no owner' };
    // An invoice for another subscription (the slots add-on, or an old one) says nothing about the membership.
    const mainId = owner.doc.billing.subscriptionId;
    if (mainId && invoiceSubscriptionId(obj) !== mainId) return { note: 'other subscription' };
    snap();
    if (event.type === 'invoice.paid') sync.applyPaid(owner.doc.billing, obj);
    else sync.applyPaymentFailed(owner.doc.billing, now);
  }

  if (!owner) return { note: 'ignored' };
  await owner.doc.save();

  // Tell them what changed (only on a real change of status; best effort).
  await billingEmails.notifyChange(owner.type, owner.doc, before);
  // A membership that has ended takes the paid slots add-on with it.
  const slotsB = owner.doc.billing.slots;
  if (owner.type === 'recruiter' && owner.doc.billing.status === 'canceled' && slotsB && slotsB.subscriptionId && (slotsB.status === 'active' || slotsB.status === 'past_due')) {
    try { await stripe.subscriptions.cancel(slotsB.subscriptionId); } catch (e) { console.error('Could not cancel slots add-on:', e.message); }
  }
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
