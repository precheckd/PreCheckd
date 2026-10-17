const mongoose = require('mongoose');

// "Not interested" (or a scam report) from someone a candidate wrote to: that
// candidate may not email this address again. Scoped to one member; "stop all"
// goes on the shared Suppression list instead.
const mailBlockSchema = new mongoose.Schema({
  namespace: { type: String, enum: ['candidate'], default: 'candidate' },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  toEmail: { type: String, required: true, lowercase: true, trim: true },
  reason: { type: String, enum: ['not_interested', 'scam_report'], required: true }
}, { timestamps: true });

mailBlockSchema.index({ ownerId: 1, toEmail: 1 }, { unique: true });

module.exports = mongoose.model('MailBlock', mailBlockSchema);
