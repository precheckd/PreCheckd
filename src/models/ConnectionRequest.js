const mongoose = require('mongoose');

const connectionRequestSchema = new mongoose.Schema({
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
    default: null,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending'
  },
  // Who sent this request. Candidate-initiated is the original flow
  // (candidate browsing /recruiter-search); recruiter-initiated is the
  // symmetric flow from /candidate-search. Everything else about the
  // request (accept/decline, messaging once accepted) works the same
  // either way — only who the "requester" was differs.
  initiatedBy: {
    type: String,
    enum: ['candidate', 'recruiter'],
    default: 'candidate'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    default: () => Date.now() + 30 * 24 * 60 * 60 * 1000
  },

  // Bundled video + resume access request — only meaningful once status
  // is 'accepted'. A single grant/deny covers both assets; there's no
  // separate approval for video vs. resume. 'denied' is final for this
  // connection — a recruiter can't re-request on the same one. An
  // unanswered 'requested' expires after 30 days (fullAccessExpiresAt),
  // same pattern as the connection request itself, and can be
  // re-requested after that.
  fullAccessStatus: {
    type: String,
    enum: ['none', 'requested', 'granted', 'denied'],
    default: 'none'
  },
  fullAccessRequestedAt: {
    type: Date,
    default: null
  },
  fullAccessRespondedAt: {
    type: Date,
    default: null
  },
  fullAccessExpiresAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('ConnectionRequest', connectionRequestSchema);