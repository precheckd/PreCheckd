const mongoose = require('mongoose');

// "Not interested" (or a scam report): this recruiter may never email this
// address again. Scoped to one recruiter; "stop all" goes on the shared
// Suppression list instead.
const outreachBlockSchema = new mongoose.Schema({
  recruiterId: { type: mongoose.Schema.Types.ObjectId, required: true },
  toEmail: { type: String, required: true, lowercase: true, trim: true },
  reason: { type: String, enum: ['not_interested', 'scam_report'], required: true }
}, { timestamps: true });

outreachBlockSchema.index({ recruiterId: 1, toEmail: 1 }, { unique: true });

module.exports = mongoose.model('OutreachBlock', outreachBlockSchema);
