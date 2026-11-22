// An invite to the free founding year (first 100 recruiters). Created by staff (a code to send someone) or by a visitor
// asking for one (status 'requested' until staff approve it, which makes the code). One code, one use.
const mongoose = require('mongoose');

const foundingInviteSchema = new mongoose.Schema({
  // Null until a request is approved.
  code: { type: String, default: null },
  status: { type: String, enum: ['requested', 'open', 'redeemed', 'revoked', 'declined'], default: 'open', index: true },
  source: { type: String, enum: ['staff', 'request'], default: 'staff' },
  // Staff's own label for a code they hand out, or what a requester told us.
  note: { type: String, default: '', maxlength: 300 },
  name: { type: String, default: '', maxlength: 120 },
  email: { type: String, default: '', maxlength: 160 },
  company: { type: String, default: '', maxlength: 160 },
  about: { type: String, default: '', maxlength: 600 },
  redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', default: null },
  redeemedAt: { type: Date, default: null },
  decidedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

foundingInviteSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });

module.exports = mongoose.models.FoundingInvite || mongoose.model('FoundingInvite', foundingInviteSchema);
