// What is left after someone deletes their account: one-way hashes only, no name, no email, no phone, no content.
// It exists for two reasons: a suspended account cannot wipe itself and sign up again, and a one-time offer
// (the free year, the waived verification fee) cannot be claimed twice.
const mongoose = require('mongoose');

const deletedAccountSchema = new mongoose.Schema({
  kind: { type: String, enum: ['candidate', 'recruiter'], required: true },
  emailHash: { type: String, required: true, index: true },
  phoneHash: { type: String, default: null, index: true },
  blocked: { type: Boolean, default: false },
  hadFreeYear: { type: Boolean, default: false },
  hadWaivedFee: { type: Boolean, default: false },
  deletedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('DeletedAccount', deletedAccountSchema);
