const mongoose = require('mongoose');

// A recruiter inviting one applicant to the finalist (second-stage) test for a posting.
//
// Lifecycle: sent -> accepted (candidate starts it) -> completed, or declined / expired / failed.
// A posting has FINALIST_SLOTS slots (services/finalistTests.js). A slot is held while a request is sent, accepted
// or completed, and comes back when it is declined, expires, or the attempt is rejected by the integrity review.
// When a request ends without a score, the recruiter decides what happens to the applicant (decision): 'kept' or
// 'rejected', unless the posting's auto-reject switch is on (decidedBy 'auto').
const finalistTestSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true, index: true },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobApplication', required: true, index: true },
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  assessmentId: { type: String, required: true },
  topics: { type: [String], default: [] },
  status: { type: String, enum: ['sent', 'accepted', 'completed', 'declined', 'expired', 'failed'], default: 'sent', index: true },
  sentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },          // the candidate must start by then
  respondedAt: { type: Date, default: null },
  resultId: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillResult', default: null },
  completedAt: { type: Date, default: null },
  score: { type: Number, default: null },
  topicScores: { type: [{ key: String, score: Number, _id: false }], default: [] },
  recruiterNotified: { type: Boolean, default: false },
  // Only for requests that ended without a score.
  decision: { type: String, enum: [null, 'kept', 'rejected'], default: null },
  decidedAt: { type: Date, default: null },
  decidedBy: { type: String, enum: [null, 'recruiter', 'auto', 'resent'], default: null },
}, { timestamps: true });

finalistTestSchema.index({ jobId: 1, status: 1 });

module.exports = mongoose.model('FinalistTest', finalistTestSchema);
