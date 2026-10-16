const mongoose = require('mongoose');

// "Report as scam" on a received message. Two effects:
//   1. the reporting owner never receives mail from that sender again
//      (inbound drops it), and
//   2. staff get a record to review. One person's report never blocks a sender
//      for everyone: staff decide, usually after several independent reports,
//      and add the address or domain to the shared do-not-contact list
//      (npm run mail-alias -- block ...).
const mailReportSchema = new mongoose.Schema({
  namespace: { type: String, enum: ['candidate', 'recruiter'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  fromAddress: { type: String, required: true, lowercase: true, trim: true },
  fromDomain: { type: String, default: null },
  subject: { type: String, default: null },
  senderCheck: { type: String, default: 'unverified' },
  status: { type: String, enum: ['new', 'reviewed'], default: 'new' }
}, { timestamps: true });

// One report per owner per sender address.
mailReportSchema.index({ namespace: 1, ownerId: 1, fromAddress: 1 }, { unique: true });
mailReportSchema.index({ fromAddress: 1 });
mailReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('MailReport', mailReportSchema);
