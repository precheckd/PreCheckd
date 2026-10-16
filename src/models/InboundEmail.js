const mongoose = require('mongoose');

// Log of mail received at a PreCheckd address and what we did with it.
// Metadata only: message bodies stay with Resend, and nothing here is shown
// to anyone except the address owner (and later the tracker). One row per
// (received email, recipient alias), which is also what makes a retried
// webhook safe: a message already forwarded is never forwarded twice.
const inboundEmailSchema = new mongoose.Schema({
  emailId: { type: String, required: true },          // Resend's id for the received email
  aliasId: { type: mongoose.Schema.Types.ObjectId, ref: 'MailAlias', required: true },
  namespace: { type: String, enum: ['candidate', 'recruiter'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  fromAddress: { type: String, default: null },
  fromName: { type: String, default: null },
  subject: { type: String, default: null },
  attachmentCount: { type: Number, default: 0 },
  // delivered: saved in the owner's PreCheckd Mail
  // forwarded: (legacy) relayed to the owner's real inbox, before Mail existed
  // held: not delivered (virus verdict, daily cap); staff-visible only
  // dropped: suppressed sender
  // failed: delivery attempt errored; the webhook retry tries again
  // processing: claimed, send in progress
  status: {
    type: String,
    enum: ['processing', 'delivered', 'forwarded', 'held', 'dropped', 'failed'],
    default: 'processing'
  },
  reason: { type: String, default: null },
  // verified_recruiter: sender address belongs to a verified PreCheckd
  // recruiter AND the message passed sender authentication.
  senderCheck: { type: String, enum: ['verified_recruiter', 'unverified'], default: 'unverified' },
  forwardedEmailId: { type: String, default: null }, // legacy (relay)
  receivedAt: { type: Date, default: Date.now }
}, { timestamps: true });

inboundEmailSchema.index({ emailId: 1, aliasId: 1 }, { unique: true });
inboundEmailSchema.index({ aliasId: 1, receivedAt: -1 });

module.exports = mongoose.model('InboundEmail', inboundEmailSchema);
