const mongoose = require('mongoose');

// A recruiter asking one of their connections to take a job-title test.
//
// Lifecycle: sent -> accepted (candidate starts it) -> completed, or declined / expired / failed.
// A credit is held while the request is live (sent, or accepted with a live invite) and is spent when
// the candidate completes it. Declined, expired and rejected attempts give the credit back, so the
// count is always derived from these rows (see services/testRequests.js); nothing is stored on the recruiter.
const testRequestSchema = new mongoose.Schema({
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true, index: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  assessmentId: { type: String, required: true },
  status: { type: String, enum: ['sent', 'accepted', 'completed', 'declined', 'expired', 'failed'], default: 'sent', index: true },
  // 'YYYY-MM' (New York time) the request was sent in. Credits and the per-connection cap are counted by this.
  month: { type: String, required: true, index: true },
  sentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },        // the candidate must answer by then
  respondedAt: { type: Date, default: null },
  resultId: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillResult', default: null },
  completedAt: { type: Date, default: null },
  recruiterNotified: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('TestRequest', testRequestSchema);
