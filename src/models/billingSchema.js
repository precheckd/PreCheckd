// Subscription state kept on a Recruiter or Candidate. Stripe is the source of truth; the webhook keeps this in step.
const mongoose = require('mongoose');

// status mirrors Stripe: incomplete, active, past_due, canceled, unpaid. `none` = never subscribed.
const billingSchema = new mongoose.Schema({
  customerId: { type: String, default: null },
  subscriptionId: { type: String, default: null },
  plan: { type: String, enum: [null, 'monthly', 'annual'], default: null },
  status: { type: String, enum: ['none', 'incomplete', 'active', 'past_due', 'canceled', 'unpaid'], default: 'none' },
  currentPeriodEnd: { type: Date, default: null },
  // Set when a payment fails: access continues until this moment (14 days), then the account lapses.
  graceUntil: { type: Date, default: null },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  // Candidates only: the one-time verification fee ($79, or waived for the first 1,000).
  verificationFee: {
    paidAt: { type: Date, default: null },
    waived: { type: Boolean, default: false }
  },
  // Recruiters only: founding wave and the locked annual price in cents while subscribed.
  founding: {
    wave: { type: Number, default: null },
    priceCents: { type: Number, default: null },
    // reservedAt: a spot is held while the person is at Stripe Checkout (35 minutes). lockedAt: payment landed.
    reservedAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null }
  },
  // Recruiters only: extra open-posting slots bought as an add-on (base plan includes 5).
  extraSlots: { type: Number, default: 0 }
}, { _id: false });

module.exports = billingSchema;
