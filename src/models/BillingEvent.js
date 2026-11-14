// One row per Stripe webhook event we have handled. The unique index on eventId is what makes
// a retried webhook harmless: the second insert fails and the handler skips it.
const mongoose = require('mongoose');

const billingEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  ownerType: { type: String, enum: ['recruiter', 'candidate', null], default: null },
  ownerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  note: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

billingEventSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('BillingEvent', billingEventSchema);
