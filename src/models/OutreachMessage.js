const mongoose = require('mongoose');

// One outreach email a verified recruiter sent to a person who is not yet on
// PreCheckd (roadmap #4). The recipient's own choices are recorded here too, so
// a recruiter cannot keep writing to someone who said no.
const outreachMessageSchema = new mongoose.Schema({
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true, index: true },
  toEmail: { type: String, required: true, lowercase: true, trim: true },
  toName: { type: String, default: '' },
  templateKey: { type: String, required: true },
  role: { type: String, default: '' },
  note: { type: String, default: '' },
  subject: { type: String, required: true },
  status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
  emailId: { type: String, default: null },
  // What the recipient did with the email's link, if anything.
  recipientAction: { type: String, enum: ['not_interested', 'stop_all', 'scam_report', null], default: null },
  recipientActionAt: { type: Date, default: null },
  reportReviewed: { type: Boolean, default: false },
  sentAt: { type: Date, default: Date.now }
}, { timestamps: true });

outreachMessageSchema.index({ recruiterId: 1, sentAt: -1 });
outreachMessageSchema.index({ recruiterId: 1, toEmail: 1, sentAt: -1 });
outreachMessageSchema.index({ recipientAction: 1, reportReviewed: 1 });

module.exports = mongoose.model('OutreachMessage', outreachMessageSchema);
