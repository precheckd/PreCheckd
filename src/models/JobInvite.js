const mongoose = require('mongoose');

// A recruiter invited one of their connections to apply for one of their postings. One row per posting and
// candidate, so nobody is invited twice to the same job.
const jobInviteSchema = new mongoose.Schema({
  postingId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectionRequest', required: true },
  createdAt: { type: Date, default: Date.now },
});
jobInviteSchema.index({ postingId: 1, candidateId: 1 }, { unique: true });
jobInviteSchema.index({ recruiterId: 1, createdAt: -1 });

module.exports = mongoose.model('JobInvite', jobInviteSchema);
