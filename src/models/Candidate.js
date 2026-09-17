const mongoose = require('mongoose');

const workHistorySchema = new mongoose.Schema({
  employerName: { type: String, required: true },
  jobTitle: { type: String, required: true },
  startDate: { type: String, required: true }, // stored as "YYYY-MM" for simplicity
  endDate: { type: String, default: null }, // null or "Present" means current
}, { _id: false });

const educationHistorySchema = new mongoose.Schema({
  schoolName: { type: String, required: true },
  degree: { type: String, required: true },
  graduationDate: { type: String, required: true }, // "YYYY-MM", may be expected/future date
}, { _id: false });

const certificationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  credentialId: { type: String, default: null }, // often not on the resume; candidate fills in on review
  verified: { type: Boolean, default: false }, // flips true once the certification agent confirms it
  verifiedAt: { type: Date, default: null },
}, { _id: false });

const candidateSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  slug: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: true
  },

  bio: {
    type: String,
    default: null
  },

  // Work/education history — populated via resume parsing or manual entry
  workHistory: {
    type: [workHistorySchema],
    default: []
  },
  educationHistory: {
    type: [educationHistorySchema],
    default: []
  },
  certifications: {
    type: [certificationSchema],
    default: []
  },
  resumeUrl: {
    type: String,
    default: null
  },
  resumeParsingStatus: {
    type: String,
    enum: ['none', 'pending', 'complete', 'failed'],
    default: 'none'
  },

  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  phoneVerifiedAt: {
    type: Date,
    default: null
  },

  emailVerifiedAt: {
    type: Date,
    default: null
  },
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationExpires: {
    type: Date,
    default: null
  },

  loginToken: {
    type: String,
    default: null
  },
  loginTokenExpires: {
    type: Date,
    default: null
  },

  // Identity verification (Stripe Identity — same pattern as recruiters)
  isIdentityVerified: {
    type: Boolean,
    default: false
  },
  identityVerifiedAt: {
    type: Date,
    default: null
  },
  facialRecognitionVerifiedAt: {
    type: Date,
    default: null
  },
  stripeVerificationSessionId: {
    type: String,
    default: null
  },

  // Employment — manual/blocked for now (Work Number)
  employmentVerifiedAt: {
    type: Date,
    default: null
  },

  // Education — manual phone verification (Clearinghouse)
  educationVerifiedAt: {
    type: Date,
    default: null
  },

  // Certifications — via existing AI agent (see `certifications` array above
  // for per-certification data; this stays for an overall "batch checked" timestamp)
  certificationsVerifiedAt: {
    type: Date,
    default: null
  },

  // Hard/soft skills — CoderByte assessment
  skillsAssessmentCompletedAt: {
    type: Date,
    default: null
  },
  skillsAssessmentScore: {
    type: Number,
    default: null
  },

  // Background check — employer-triggered, not run at signup
  backgroundCheckStatus: {
    type: String,
    default: null // null until an employer actually requests one
  },

  // Self-reported, never independently verified
  securityClearance: {
    type: String,
    default: null
  },

  status: {
    type: String,
    default: 'pre_candidate'
  },
  fullVerificationComplete: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

candidateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Candidate', candidateSchema);