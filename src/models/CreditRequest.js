const mongoose = require('mongoose');

// A candidate asking for more skill-test credits. One open request at a time; staff decide by hand and can
// add a note that the candidate sees. Granted credits are added to Candidate.creditBonusGranted.
const creditRequestSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  amount: { type: Number, required: true, min: 1, max: 10 },
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'approved', 'declined'], default: 'open', index: true },
  grantedAmount: { type: Number, default: 0 },
  staffNote: { type: String, default: '', maxlength: 500 },
  decidedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('CreditRequest', creditRequestSchema);
