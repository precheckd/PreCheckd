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
  // Last day the cert is valid (UTC midnight of that day), or null if it has
  // no expiry. Copied from Credly when matched; otherwise entered by hand.
  expiresAt: { type: Date, default: null },
  // Expiry reminders already sent, as "<expiry day>:<days>" (e.g.
  // "2027-03-01:30"). Keyed by expiry day, so a renewal (new date) starts
  // fresh without needing to clear anything.
  remindersSent: { type: [String], default: [] },
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

  // Self-reported, not verified (no verification path for this exists —
  // flagged as such wherever it's shown to a recruiter). A fixed list
  // rather than free text so recruiters can actually filter by it.
  securityClearance: {
    type: String,
    enum: ['none', 'public_trust', 'secret', 'top_secret', 'ts_sci', 'other'],
    default: 'none'
  },
  // Free text, only meaningful when securityClearance === 'other'.
  securityClearanceOther: {
    type: String,
    default: null
  },

  // Optional, informational only — not used to filter anything. Same tier
  // as preferredSalary: good context for a recruiter who's already
  // reaching out, not a search gate.
  noticePeriod: {
    type: String,
    enum: ['immediately_available', 'two_weeks', 'currently_employed_flexible'],
    default: null
  },

  // Computed from workHistory, never self-declared (Kent: no claiming 10
  // years of experience when the work history only shows 3). Recomputed
  // in the pre-save hook below whenever work history changes. null until
  // there's at least one work-history entry with a usable start date.
  // Informational only — NOT a required field and NOT used to gate
  // anything. An earlier pass also bucketed this into an overall
  // Entry/Mid/Senior/Lead band and required it for search visibility;
  // rolled back (Oct 3, 2026) since there's no honest single-number way
  // to separate "25 years as a help-desk tech" from "25 years running
  // infrastructure." That distinction is going to come from a future
  // per-skill leveling system instead (see roadmap) — not this field.
  experienceYears: {
    type: Number,
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

  // Whether this candidate has a public /verify/:slug page. Off by default
  // and always an explicit opt-in: the page shows they're on PreCheckd, which
  // is exactly what the pre-connection anonymization otherwise hides.
  publicVerifyPage: {
    type: Boolean,
    default: false
  },

  // Which verified sections the public page shows. Chosen by the candidate.
  // Only verified entries are ever shown, and never employer or school names.
  // Certifications default on (the original page content); degrees and job
  // titles are off until the candidate switches them on.
  publicSections: {
    certifications: { type: Boolean, default: true },
    degrees: { type: Boolean, default: false },
    jobTitles: { type: Boolean, default: false }
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

  // Where the candidate is willing to work, arrangement-wise. A multi-select
  // — a candidate can pick more than one (e.g. remote + hybrid). Starts
  // empty and is one of the required matching fields (see
  // utils/candidateMatchingRequirements.js): leaving it blank would mean
  // "I'm not willing to work remote, hybrid, or in-office," which isn't a
  // real answer for someone job-hunting, so it's required rather than
  // defaulting to "open to any" the way other optional fields do.
  workArrangement: {
    type: [String],
    enum: ['remote', 'hybrid', 'in_office'],
    default: []
  },

  // Optional recurring weekly availability — NOT one of the required
  // matching fields (unlike workAreas/minSalary). A candidate who leaves
  // this blank still shows up normally; it only matters once a recruiter
  // filters a search by a role's required hours (see
  // utils/availabilityMatching.js), at which point it's used to group —
  // not simply exclude — results, since "never set" isn't the same as
  // "confirmed can't do it."
  availableDays: {
    type: [String],
    enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    default: []
  },
  // "HH:MM" 24-hour time strings. An end time at or before the start time
  // means the window wraps past midnight (an overnight shift) rather than
  // being treated as invalid.
  availableStartTime: {
    type: String,
    default: null
  },
  availableEndTime: {
    type: String,
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },

  // When this account's last unread-messages digest email went out (see
  // services/messageDigest.js) — at most one a day, and also what stops two
  // server instances from both sending it.
  lastMessageDigestAt: {
    type: Date,
    default: null
  }
});

const FULL_TIME_ANNUAL_HOURS = 2080; // 40 hrs/week * 52 weeks — standard full-time-year assumption
const { computeExperience } = require('../utils/experienceLevel');

candidateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();

  if (typeof this.minSalaryAmount === 'number' && this.minSalaryAmount > 0) {
    this.minSalaryAnnualEquivalent = this.minSalaryType === 'hourly'
      ? this.minSalaryAmount * FULL_TIME_ANNUAL_HOURS
      : this.minSalaryAmount;
  } else {
    this.minSalaryAnnualEquivalent = null;
  }

  const { years } = computeExperience(this.workHistory);
  this.experienceYears = years;

  next();
});

candidateSchema.index({ workAreas: '2dsphere' });

module.exports = mongoose.model('Candidate', candidateSchema);