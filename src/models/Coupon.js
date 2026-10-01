const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },

  issuedToEmail: { type: String, required: true, trim: true, lowercase: true },

  // Where this code came from — lets you track which channel drives signups.
  source: {
    type: String,
    enum: ['fraud-report-thankyou', 'referral-partner', 'general-promo'],
    required: true
  },
  // Flexible pointer back to whatever triggered the code (a FraudReport._id for now,
  // could point elsewhere later). Not a strict ref since the source type varies.
  sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },

  // For the referral-partner flow later — which partner gets credit for this code.
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', default: null },

  discountType: {
    type: String,
    enum: ['percentage', 'fixed_amount', 'free_trial_days'],
    required: true
  },
  discountValue: { type: Number, required: true },

  isRedeemed: { type: Boolean, default: false },
  redeemedAt: { type: Date, default: null },

  expiresAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);