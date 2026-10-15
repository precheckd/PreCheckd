const mongoose = require('mongoose');

// One row per PreCheckd mail address (alias@in.precheckd.com for candidates,
// alias@recruiters.precheckd.com for recruiters). This collection is the
// source of truth for who owns an address, so:
//   - uniqueness is enforced per namespace by the database, not by checking
//     two other collections;
//   - rows are never deleted, so an address is never handed to a different
//     person after an account closes;
//   - an address can be switched off instantly (status: 'disabled') without
//     touching the account.
const mailAliasSchema = new mongoose.Schema({
  namespace: {
    type: String,
    enum: ['candidate', 'recruiter'],
    required: true
  },
  alias: {
    type: String,
    required: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active'
  },
  disabledReason: {
    type: String,
    default: null
  },
  disabledAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

mailAliasSchema.index({ namespace: 1, alias: 1 }, { unique: true });
// One primary alias per account.
mailAliasSchema.index({ namespace: 1, ownerId: 1 }, { unique: true });

module.exports = mongoose.model('MailAlias', mailAliasSchema);
