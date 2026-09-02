const mongoose = require('mongoose');

const recruiterSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    company: { type: String, trim: true },

    verifications: {
      email: {
        confirmed: { type: Boolean, default: false },
        confirmedAt: Date,
        code: String,
        expiresAt: Date
      },
      phone: {
        confirmed: { type: Boolean, default: false },
        confirmedAt: Date,
        code: String,
        expiresAt: Date
      },
      identity: {
        confirmed: { type: Boolean, default: false },
        confirmedAt: Date,
        sumsubApplicantId: String,
        sumsubStatus: String,
        sumsubLinkExpiresAt: Date
      }
    },

    stripeCustomerId: { type: String },
    stripeCheckoutSessionId: { type: String },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },

    status: {
      type: String,
      enum: ['incomplete', 'pending_phone', 'pending_identity', 'active', 'suspended'],
      default: 'incomplete',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Recruiter', recruiterSchema);