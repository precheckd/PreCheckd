// Recruiter subscription: pick the plan, hold a founding spot, send them to Stripe Checkout, and sync on return.
const Recruiter = require('../models/Recruiter');
const plans = require('./billingPlans');
const sync = require('./billingSync');

// Spots taken per wave: locked (paid) ones plus fresh reservations still inside their 35-minute window.
async function waveCounts(now = new Date()) {
  const cutoff = new Date(new Date(now).getTime() - plans.RESERVE_MINUTES * 60000);
  const taken = {};
  for (const w of plans.WAVES) {
    taken[w.wave] = await Recruiter.countDocuments({
      'billing.founding.wave': w.wave,
      $or: [
        { 'billing.founding.lockedAt': { $ne: null }, 'billing.status': { $in: ['active', 'past_due', 'unpaid'] } },
        { 'billing.founding.lockedAt': null, 'billing.founding.reservedAt': { $gt: cutoff } },
      ],
    });
  }
  return taken;
}

async function status(now, opts) {
  return plans.waveStatus(await waveCounts(now), opts);
}

function hadFounding(recruiter) {
  const f = (recruiter.billing && recruiter.billing.founding) || {};
  return Boolean(f.lockedAt);
}

async function ensureCustomer(stripe, recruiter) {
  if (recruiter.billing.customerId) return recruiter.billing.customerId;
  const customer = await stripe.customers.create({
    email: recruiter.email,
    name: [recruiter.firstName, recruiter.lastName].filter(Boolean).join(' '),
    phone: recruiter.phone || undefined,
    metadata: { ownerType: 'recruiter', ownerId: String(recruiter._id) },
  });
  recruiter.billing.customerId = customer.id;
  await recruiter.save();
  return customer.id;
}

// Starts Checkout. Returns { url }. `interval` is 'monthly' or 'annual'.
// `invite` (a usable FoundingInvite) turns this into the free founding year: annual $349 locked, with a 365-day trial.
async function startCheckout({ stripe, recruiter, interval, baseUrl, successPath, cancelPath, invite = null, now = new Date() }) {
  const st = invite ? await status(now, { invite: true }) : await status(now);
  // A one-time offer: someone who deleted an account that had its free year can't claim another.
  if (invite) { const prev = await require('./accountDeletion').previous({ email: recruiter.email, phone: recruiter.phone }); if (prev && prev.hadFreeYear) { const e = new Error('The founding invite spots are full.'); e.code = 'invite_full'; throw e; } }
  if (invite && (!st.freeDays || hadFounding(recruiter))) { const e = new Error('The founding invite spots are full.'); e.code = 'invite_full'; throw e; }
  const choice = plans.choosePlan({ interval: invite ? 'annual' : interval, status: st, hadFounding: hadFounding(recruiter) });
  if (!choice) { const e = new Error('Pick monthly or annual.'); e.code = 'bad_interval'; throw e; }
  if (recruiter.billing.status === 'active') { const e = new Error('Already subscribed.'); e.code = 'already_active'; throw e; }

  const customerId = await ensureCustomer(stripe, recruiter);
  const priceId = await plans.ensurePrice(stripe, choice.plan);

  // Hold the founding spot while they pay.
  if (choice.wave) {
    recruiter.billing.founding = { wave: choice.wave, priceCents: st.priceCents, locked: choice.locked, reservedAt: new Date(now), lockedAt: null };
  } else if (!hadFounding(recruiter)) {
    recruiter.billing.founding = { wave: null, priceCents: null, locked: false, reservedAt: null, lockedAt: null };
  }
  recruiter.billing.status = recruiter.billing.status === 'none' ? 'incomplete' : recruiter.billing.status;
  await recruiter.save();

  const owner = { ownerType: 'recruiter', ownerId: String(recruiter._id) };
  if (invite) owner.inviteId = String(invite._id);
  const discounts = choice.discountCents ? [{ coupon: await plans.ensureCoupon(stripe, choice.discountCents) }] : null;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(recruiter._id),
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    customer_update: { address: 'auto', name: 'auto' },
    ...(discounts ? { discounts } : { allow_promotion_codes: false }), // Stripe allows only one of the two
    // The free year is a trial; the card is always collected so the paid year can start by itself.
    ...(invite ? { payment_method_collection: 'always' } : {}),
    metadata: owner,
    subscription_data: { metadata: owner, ...(invite ? { trial_period_days: choice.freeDays } : {}) },
    success_url: `${baseUrl}${successPath}${successPath.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}${cancelPath}`,
  });
  return { url: session.url, plan: choice.plan, wave: choice.wave };
}

// They came back from Checkout: do not wait for the webhook, read the session and sync now.
async function confirmReturn({ stripe, recruiter, sessionId, now = new Date() }) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session || session.client_reference_id !== String(recruiter._id)) { const e = new Error('That payment is not yours.'); e.code = 'mismatch'; throw e; }
  if (session.mode !== 'subscription' || !session.subscription) { const e = new Error('Not a subscription.'); e.code = 'not_subscription'; throw e; }
  // A free-year trial has nothing to pay yet, so Stripe reports no_payment_required once the card is saved.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return { paid: false };
  const subId = typeof session.subscription === 'object' ? session.subscription.id : session.subscription;
  const sub = await stripe.subscriptions.retrieve(subId);
  const before = require('./billingEmails').stateOf(recruiter.billing);
  sync.applySubscription(recruiter.billing, sub, now);
  await recruiter.save();
  await startFreeYearIfInvited(recruiter, sub, session.metadata, now);
  await require('./billingEmails').notifyChange('recruiter', recruiter, before);
  return { paid: recruiter.billing.status === 'active' };
}

// When the checkout carried an invite, mark it used and begin the free-year tracking. Safe to run twice
// (the return page and the webhook both call it).
async function startFreeYearIfInvited(recruiter, sub, metadata, now = new Date()) {
  const inviteId = metadata && metadata.inviteId;
  if (!inviteId || !sub || sub.status !== 'trialing') return false;
  const invite = await require('./foundingInvites').redeem(inviteId, recruiter._id, now);
  if (!invite) return false;
  return require('./freeYear').start(recruiter, invite, sub, now);
}

async function portalUrl({ stripe, recruiter, returnUrl }) {
  if (!recruiter.billing.customerId) { const e = new Error('No billing account yet.'); e.code = 'no_customer'; throw e; }
  const s = await stripe.billingPortal.sessions.create({ customer: recruiter.billing.customerId, return_url: returnUrl });
  return s.url;
}

module.exports = { waveCounts, status, startCheckout, confirmReturn, portalUrl, hadFounding, startFreeYearIfInvited };
