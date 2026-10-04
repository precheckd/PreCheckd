const mongoose = require('mongoose');
const crypto = require('crypto');

const workHistorySchema = new mongoose.Schema({
  employerName: { type: String, required: true },
  jobTitle: { type: String, required: true },
  startDate: { type: String, default: null }, // "YYYY-MM" — not always determinable from a resume
  endDate: { type: String, default: null }, // null means current
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date, default: null },
}, { _id: false });

const educationHistorySchema = new mongoose.Schema({
  schoolName: { type: String, required: true },
  degree: { type: String, required: true },
  graduationDate: { type: String, default: null }, // "YYYY-MM" — not always determinable from a resume
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date, default: null },
}, { _id: false });

const certificationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  credentialId: { type: String, default: null },
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date, default: null },
}, { _id: false });

// A badge found in a candidate's Credly wallet that doesn't match any
// certification they've already listed — shown to them as an opt-in
// "add this?" prompt, never added automatically.
const credlyUnmatchedBadgeSchema = new mongoose.Schema({
  badgeId: { type: String, required: true },
  name: { type: String, required: true },
  issuerName: { type: String, default: null },
  issuedAt: { type: String, default: null },
  expiresAt: { type: String, default: null },
}, { _id: false });

// One recorded answer to a fixed interview question (see
// src/utils/interviewQuestions.js for the question bank). No scoring field
// here — a rubric exists for later use, but this pass only stores the video.
const interviewVideoSchema = new mongoose.Schema({
  questionId: { type: Number, required: true },
  question: { type: String, required: true },
  videoUrl: { type: String, default: null },
  recordedAt: { type: Date, default: null },
}, { _id: false });

function generateAnonId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
}

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
  anonId: {
    type: String,
    unique: true,
    default: generateAnonId
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: true,
    unique: true
  },
  passwordHash: {
    type: String,
    default: null
  },

  bio: {
    type: String,
    default: null
  },
  profilePhotoUrl: {
    type: String,
    default: null
  },
  introVideoUrl: {
    type: String,
    default: null
  },
  interviewVideos: {
    type: [interviewVideoSchema],
    default: []
  },

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

  // Credly username (not a full URL — just the identifier, e.g. "kent-mayer"
  // from credly.com/users/kent-mayer). Populated either by a successful
  // background auto-guess or by the candidate manually providing it on the
  // edit screen. Used to fetch their public badge wallet and auto-verify
  // matching certifications.
  credlyUsername: {
    type: String,
    default: null
  },
  credlyLastSyncedAt: {
    type: Date,
    default: null
  },
  // Badges found in the candidate's Credly wallet during the last sync
  // that didn't match any existing certification entry — surfaced as an
  // opt-in "we found more badges, want to add them?" prompt. Cleared as
  // the candidate adds or dismisses each one.
  credlyUnmatchedBadges: {
    type: [credlyUnmatchedBadgeSchema],
    default: []
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

  // Password reset / first-time-set-password token flow (also doubles as
  // the one-time migration link for accounts created before passwords
  // existed). Single-use, cleared as soon as it's consumed.
  loginToken: {
    type: String,
    default: null
  },
  loginTokenExpires: {
    type: Date,
    default: null
  },

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

  skillsAssessmentCompletedAt: {
    type: Date,
    default: null
  },
  skillsAssessmentScore: {
    type: Number,
    default: null
  },

  backgroundCheckStatus: {
    type: String,
    default: null
  },

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

  // Whether this candidate shows up in recruiters' candidate search.
  // Defaults to on — a candidate who built a profile here is assumed to
  // want to be found, and a surprise opt-in step would just mean quieter
  // profiles with no obvious reason why. Toggled off from the edit page.
  openToOpportunities: {
    type: Boolean,
    default: true
  },

  // GeoJSON MultiPolygon of the area(s) a candidate is willing to work —
  // drawn freehand on a map rather than expressed as a commute radius, so
  // a candidate can trace exactly where they'll go (e.g. Manhattan but not
  // Brooklyn) and exclude areas a radius would wrongly include (e.g. across
  // the Long Island Sound). MultiPolygon natively supports multiple
  // disjoint shapes, so no extra schema work was needed for that.
  //
  // Deliberately no `default` here: a candidate who hasn't drawn anything
  // should simply omit this field rather than store an empty/invalid
  // coordinates array, which can fail 2dsphere validation. The 2dsphere
  // index below still applies — documents without the field are just
  // excluded from geo queries, which is the desired behavior (no drawn
  // area means "not matched by a pinned job location" rather than
  // "matches everywhere").
  workAreas: {
    type: {
      type: String,
      enum: ['MultiPolygon'],
    },
    // Mixed rather than a strictly-typed nested array — GeoJSON
    // MultiPolygon coordinates nest four levels deep ([polygon][ring]
    // [point][lng/lat]), and Mongoose's array-of-array casting at that
    // depth is unreliable. MongoDB validates the shape at the 2dsphere
    // index itself, so strict schema typing here isn't needed.
    coordinates: mongoose.Schema.Types.Mixed,
  },

  // Minimum salary the candidate would ever accept — a hard floor, never
  // shown to recruiters, used only to silently filter them out of
  // /candidate-search results a recruiter's stated budget can't meet.
  // One of the required "matching fields" (see
  // utils/candidateMatchingRequirements.js) that gate search visibility.
  minSalaryAmount: {
    type: Number,
    default: null
  },
  minSalaryType: {
    type: String,
    enum: ['annual', 'hourly'],
    default: 'annual'
  },
  // Pre-computed on save (hourly amounts * 2080, the standard 40hr/week x
  // 52-week full-time year) so search can compare a single number instead
  // of doing unit conversion inside a database query.
  minSalaryAnnualEquivalent: {
    type: Number,
    default: null
  },

  // Preferred/target salary — collected now but not used to filter
  // anything yet. Reserved for a future ranked-match feature (closer to
  // "best fit" than "hard cutoff"); minSalary above stays the only thing
  // that actually excludes a candidate from a recruiter's search.
  preferredSalaryAmount: {
    type: Number,
    default: null
  },
  preferredSalaryType: {
    type: String,
    enum: ['annual', 'hourly'],
    default: 'annual'
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

const FULL_TIME_ANNUAL_HOURS = 2080; // 40 hrs/week * 52 weeks — standard full-time-year assumption

candidateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();

  if (typeof this.minSalaryAmount === 'number' && this.minSalaryAmount > 0) {
    this.minSalaryAnnualEquivalent = this.minSalaryType === 'hourly'
      ? this.minSalaryAmount * FULL_TIME_ANNUAL_HOURS
      : this.minSalaryAmount;
  } else {
    this.minSalaryAnnualEquivalent = null;
  }

  next();
});

candidateSchema.index({ workAreas: '2dsphere' });

module.exports = mongoose.model('Candidate', candidateSchema);