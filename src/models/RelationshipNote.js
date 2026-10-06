const mongoose = require('mongoose');

// A private, per-person note an account owner keeps about someone in their
// Connections address book — a candidate's note on a recruiter, or a
// recruiter's note on a candidate. One note per (owner, other) pair, never
// shown to the other party. It deliberately lives outside ConnectionRequest
// and SavedRecruiter so a recruiter who is both saved AND connected has a
// single note instead of two that can drift apart, and so the note survives
// if either of those records changes.
const relationshipNoteSchema = new mongoose.Schema({
  ownerType: {
    type: String,
    enum: ['candidate', 'recruiter'],
    required: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  otherId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  note: {
    type: String,
    default: '',
    maxlength: 1000
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

relationshipNoteSchema.index({ ownerType: 1, ownerId: 1, otherId: 1 }, { unique: true });

module.exports = mongoose.model('RelationshipNote', relationshipNoteSchema);
