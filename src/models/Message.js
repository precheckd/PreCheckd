const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // Required for an ordinary recruiter<->candidate message. Left unset for
  // a fraud-dispute thread (see fraudReportId below) — there's no accepted
  // connection between a recruiter and "PreCheckd Trust & Safety".
  connectionRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConnectionRequest',
    default: null
  },

  // Set instead of connectionRequestId for the automated "a report was
  // filed about you" message and any replies in that thread — ties the
  // whole back-and-forth to the specific report it's about, so a second,
  // later report against the same recruiter starts its own thread rather
  // than mixing two incidents together.
  fraudReportId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FraudReport',
    default: null
  },

  senderType: {
    type: String,
    enum: ['recruiter', 'candidate', 'system'],
    required: true
  },
  // Null for 'system' — there's no real account behind "PreCheckd Trust &
  // Safety", just a fixed display name handled at render time.
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },

  recipientType: {
    type: String,
    enum: ['recruiter', 'candidate', 'system'],
    required: true
  },
  // Null for 'system' — a recruiter's dispute reply is addressed to the
  // mailbox, not a real account; staff read it from the internal dashboard
  // instead of a recipient inbox.
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },

  // 'message' is an ordinary message. The contact_* kinds are the
  // automated notices in the contact-info request flow (see
  // routes/messages.js); contact_request additionally renders Share /
  // Not now buttons for its recipient while the request is open.
  kind: {
    type: String,
    enum: ['message', 'contact_request', 'contact_shared', 'contact_declined'],
    default: 'message'
  },

  subject: {
    type: String,
    default: null
  },
  body: {
    type: String,
    required: true
  },

  sentAt: {
    type: Date,
    default: Date.now
  },
  readAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Message', messageSchema);