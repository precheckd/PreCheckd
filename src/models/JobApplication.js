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
  // Set when this applicant takes the job's role test (the role-test feature fills it in). Until then it stays
  // null, and the "role-specific test" feedback area can't be chosen for them.
  // Role test state: none (Entry level, or no test needed), waiting (we are still building it), ready (the test exists).
  roleTestStatus: { type: String, enum: ['none', 'waiting', 'ready', 'done'], default: 'none' },
  roleTestResultId: { type: mongoose.Schema.Types.ObjectId, default: null },   // the CoderByte attempt (SkillResult) for this application
  roleTestLevelKey: { type: String, default: null, index: true },   // 'titleId|Level', groups the queue
  roleTestAssessmentId: { type: String, default: null },
  roleTestReadyAt: { type: Date, default: null },
  roleTestResult: { type: { score: Number, takenAt: Date, reportUrl: String }, default: null, _id: false },
  // The candidate says the area they were given is not true. Staff review it (routes/jobs.js).
  feedbackDispute: { type: { at: Date, kind: String }, default: null, _id: false },
  // pipeline
  stageChangedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },   // code from content/rejectionReasons.js (recruiter-side)
  rejectionText: { type: String, default: '' },        // the reason sentence the candidate sees
}, { timestamps: true });

jobApplicationSchema.index({ jobId: 1, candidateId: 1 }, { unique: true });
jobApplicationSchema.index({ jobId: 1, status: 1 });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);
module.exports.STATUSES = STATUSES;
