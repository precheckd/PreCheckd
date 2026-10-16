const mongoose = require('mongoose');

// Shared do-not-contact list. An entry blocks mail in BOTH directions through
// PreCheckd addresses: inbound mail from the sender is dropped, and (once
// outbound recruiter mail exists, roadmap #5) nothing is sent to the address.
// Fed by bounces and spam complaints automatically and by staff manually.
// `value` is a full address ("a@b.com") or a bare domain ("b.com").
const suppressionSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true, lowercase: true, trim: true },
  type: { type: String, enum: ['address', 'domain'], required: true },
  reason: {
    type: String,
    enum: ['bounce', 'complaint', 'staff', 'scam_report', 'opt_out'],
    required: true
  },
  note: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Suppression', suppressionSchema);
