const mongoose = require('mongoose');

// A candidate's application to a PreCheckd job posting. One row per candidate and posting: applying again after a
// withdrawal revives the same row. The candidate's own tracker entry (models/Application) is kept in step.
const STATUSES = ['applied', 'screening', 'interviewing', 'offer', 'hired', 'rejected', 'withdrawn'];

const jobApplicationSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true, index: true },
  connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectionRequest', default: null },
  trackerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', default: null },
  status: { type: String, enum: STATUSES, default: 'applied' },
  appliedAt: { type: Date, default: Date.now },
  // withdrawn by the candidate, or automatically because the recruiter tightened a requirement
  withdrawnAt: { type: Date, default: null },
  withdrawnBy: { type: String, enum: [null, 'candidate', 'requirement_change'], default: null },
  withdrawnNote: { type: String, default: '', maxlength: 600 },
}, { timestamps: true });

jobApplicationSchema.index({ jobId: 1, candidateId: 1 }, { unique: true });
jobApplicationSchema.index({ jobId: 1, status: 1 });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);
module.exports.STATUSES = STATUSES;
