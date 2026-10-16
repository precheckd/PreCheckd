const mongoose = require('mongoose');

// A message received at a PreCheckd address, stored so the owner can read it
// inside PreCheckd (roadmap #5: the internal inbox). One row per
// (received email, recipient alias). Built generic on purpose: `namespace`
// covers candidates now and recruiters later (#4), and `direction` leaves room
// for replies sent from the site.
//
// Bodies are stored as plain text only (HTML is never kept or rendered), capped
// in length. Attachments are recorded by name/size only; the files themselves
// are not stored.
const mailMessageSchema = new mongoose.Schema({
  namespace: { type: String, enum: ['candidate', 'recruiter'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  aliasId: { type: mongoose.Schema.Types.ObjectId, ref: 'MailAlias', default: null },
  direction: { type: String, enum: ['in', 'out'], default: 'in' },
  emailId: { type: String, default: null },          // Resend's id for the received email
  fromAddress: { type: String, default: null },
  fromName: { type: String, default: null },
  subject: { type: String, default: '' },
  textBody: { type: String, default: '' },
  bodyTruncated: { type: Boolean, default: false },
  attachments: [{ _id: false, filename: String, contentType: String, size: Number }],

  // verified_recruiter: sender is a fully verified PreCheckd recruiter AND the
  // mail passed sender authentication. Anything else is unverified.
  senderCheck: { type: String, enum: ['verified_recruiter', 'unverified'], default: 'unverified' },
  recruiterName: { type: String, default: null },
  // Flagged mail (the mail provider's spam verdict) is kept out of the main
  // list and shown in a collapsed group.
  flagged: { type: Boolean, default: false },
  flagReason: { type: String, default: null },

  // Where a reply should go and the headers that keep it in the same thread.
  // Many application systems send from a no-reply address and set a separate
  // Reply-To, so the reply target is replyTo, falling back to fromAddress.
  replyTo: { type: String, default: null },
  messageIdHeader: { type: String, default: null },
  referencesHeader: { type: String, default: null },

  // direction 'out' (a reply sent from the site): who it went to and which
  // received message it answers. receivedAt doubles as the sent time.
  toAddress: { type: String, default: null },
  inReplyToMailId: { type: mongoose.Schema.Types.ObjectId, default: null },

  readAt: { type: Date, default: null },
  // Soft delete: hidden at once, and MongoDB removes the row ~30 days later
  // (TTL index below). A row with deletedAt = null is never expired.
  deletedAt: { type: Date, default: null },
  receivedAt: { type: Date, default: Date.now },
  // Sample rows from scripts/seed-demo-mail.js, removable in one command.
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

mailMessageSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
mailMessageSchema.index({ inReplyToMailId: 1 });
mailMessageSchema.index({ namespace: 1, ownerId: 1, receivedAt: -1 });
mailMessageSchema.index({ namespace: 1, ownerId: 1, readAt: 1 });
// A retried webhook never stores the same message twice. Demo rows have no
// emailId, which the partial filter leaves out.
mailMessageSchema.index(
  { emailId: 1, aliasId: 1 },
  { unique: true, partialFilterExpression: { emailId: { $type: 'string' } } }
);

module.exports = mongoose.model('MailMessage', mailMessageSchema);
