// Subscription state kept on a Recruiter or Candidate. Stripe is the source of truth; the webhook keeps this in step.
const mongoose = require('mongoose');

// status mirrors Stripe: incomplete, active, past_due, canceled, unpaid. `none` = never subscribed.
const billingSchema = new mongoose.Schema({
  customerId: { type: String, default: null },
  subscriptionId: { type: String, default: null },
  plan: { type: String, enum: [null, 'monthly', 'annual'], default: null },
  status: { type: String, enum: ['none', 'incomplete', 'active', 'past_due', 'canceled', 'unpaid'], default: 'none' },
  currentPeriodEnd: { type: Date, default: null },
  // First time the membership became active. Candidate test credits reset on this day each month.
  memberSince: { type: Date, default: null },
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
    // true for the Founders (steps 1-2): price locked while subscribed. false for Early Access: first-year price only.
    locked: { type: Boolean, default: false },
    // reservedAt: a spot is held while the person is at Stripe Checkout (35 minutes). lockedAt: payment landed.
    reservedAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null }
  },
  // Recruiters only: extra open-posting slots bought as a separate monthly subscription (the plan includes 5).
  slots: {
    subscriptionId: { type: String, default: null },
    itemId: { type: String, default: null },
    quantity: { type: Number, default: 0 },
    status: { type: String, default: 'none' }
  },
  // Recruiters only: job-title test credits bought in packs. They do not expire. Spent ones are counted from
  // TestRequest rows (see services/testRequests.js), so this is the lifetime total bought.
  testCreditsPurchased: { type: Number, default: 0 },
  // Checkout sessions already turned into credits or slots, so a page reload plus a webhook cannot do it twice.
  fulfilledSessions: { type: [String], default: [] }
}, { _id: false });

module.exports = billingSchema;
