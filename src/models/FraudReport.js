const mongoose = require('mongoose');

const fraudReportSchema = new mongoose.Schema({
  reporterEmail: { type: String, required: true, trim: true, lowercase: true },
  // Only set when the reporter was logged in as a candidate at the moment
  // they submitted — never matched retroactively by email. Filing while
  // logged out stays untracked on their side, same as today; that's a
  // deliberate choice (anonymity), not a gap to fix later.
  reporterCandidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', default: null },

  reportedEmail: { type: String, required: true, trim: true, lowercase: true },
  reportedDomain: { type: String, trim: true, lowercase: true },

  incidentDate: { type: Date },
  reasonCategory: {
    type: String,
    enum: ['payment-request', 'sensitive-info-request', 'impersonation', 'ghosting', 'other'],
    required: true
  },
  description: { type: String, required: true, trim: true },

  evidenceText: { type: String, trim: true },
  evidenceScreenshotUrl: { type: String },

  matchedRecruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', default: null },
  matchType: { type: String, enum: ['email', 'domain', null], default: null },

  // True only when this specific report actually resulted in the account
  // being contacted (exact email match AND an active account with a
  // password to notify). An exact-email match against a brand-new claim
  // account with no password yet doesn't set this — nothing was contacted.
  // This is what the Email Checker's "we've contacted this account" count
  // reads from, so it stays accurate even when matchType alone wouldn't be.
  recruiterNotified: { type: Boolean, default: false },

  status: { type: String, enum: ['pending', 'reviewed', 'dismissed', 'confirmed'], default: 'pending' },
  ipAddress: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('FraudReport', fraudReportSchema);