const mongoose = require('mongoose');

// "You qualify for this job" has been sent to this candidate for this posting. One row per pair, so each job
// is announced once however many times the candidate's profile changes.
const jobNoticeSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  createdAt: { type: Date, default: Date.now },
});
jobNoticeSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('JobNotice', jobNoticeSchema);
