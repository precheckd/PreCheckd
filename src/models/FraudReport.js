const mongoose = require('mongoose');

const fraudReportSchema = new mongoose.Schema({
  reporterEmail: { type: String, required: true, trim: true, lowercase: true },
  contactConsent: { type: Boolean, default: false },

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

  status: { type: String, enum: ['pending', 'reviewed', 'dismissed', 'confirmed'], default: 'pending' },
  ipAddress: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('FraudReport', fraudReportSchema);