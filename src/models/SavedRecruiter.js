const mongoose = require('mongoose');

// A candidate's saved/bookmarked recruiters — lets them revisit a recruiter
// later without re-searching, with an optional personal note explaining
// why they saved them or what stood out.
const savedRecruiterSchema = new mongoose.Schema({
  candidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true
  },
  recruiterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recruiter',
    required: true
  },
  note: {
    type: String,
    default: null
  },
  savedAt: {
    type: Date,
    default: Date.now
  }
});

// A candidate can only save a given recruiter once — prevents duplicate
// saves from repeated clicks, and makes "is this already saved?" a simple
// existence check.
savedRecruiterSchema.index({ candidateId: 1, recruiterId: 1 }, { unique: true });

module.exports = mongoose.model('SavedRecruiter', savedRecruiterSchema);