const mongoose = require('mongoose');

// Logs each time a recruiter views a candidate's profile — powers the
// candidate-side "Recent Profile Views" command-center widget. Deliberately
// minimal: who viewed, whose profile, when. No page-load metadata, no
// analytics bloat — this exists to answer one question for the candidate:
// "who's looked at me lately."
const profileViewSchema = new mongoose.Schema({
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
  viewedAt: {
    type: Date,
    default: Date.now
  }
});

// Fast lookups of "recent views for this candidate" — the only query
// pattern this collection actually needs to serve.
profileViewSchema.index({ candidateId: 1, viewedAt: -1 });

module.exports = mongoose.model('ProfileView', profileViewSchema);