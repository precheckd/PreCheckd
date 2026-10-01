const mongoose = require('mongoose');

const recruiterSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true
  },
  // Not required: a claim account (see accountTier below) is created from
  // just a reported email — we don't know a last name until the recruiter
  // fills in their own profile after claiming it.
  lastName: {
    type: String,
    default: null
  },
  nickname: {
    type: String,
    default: null
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
  // Not required: claim accounts (see accountTier below) are created from
  // a fraud report with only an email — no phone on file until/unless they
  // go through full paid verification. `sparse` keeps the unique index from
  // colliding across multiple claim accounts that both lack a phone (an
  // unset field is simply omitted from the index; it's only an explicit
  // null that would collide, so no default is set here either).
  phone: {
    type: String,
    unique: true,
    sparse: true
  },
  passwordHash: {
    type: String,
    default: null
  },
  // 'standard': the normal founding/paid recruiter signup flow.
  // 'unverified_claim': created automatically when a fraud report names an
  // email with no matching recruiter — can only ever see the report(s)
  // tied to them until they verify + pay, same as a standard account.
  accountTier: {
    type: String,
    enum: ['standard', 'unverified_claim'],
    default: 'standard'
  },
  company: {
    type: String,
    default: 'Not provided'
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  isIdentityVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: false
  },
  
  // Verification Timestamps
  phoneVerifiedAt: {
    type: Date,
    default: null
  },
  identityVerifiedAt: {
    type: Date,
    default: null
  },
  emailVerifiedAt: {
    type: Date,
    default: null
  },
  domainVerifiedAt: {
    type: Date,
    default: null
  },
  domainRegisteredYear: {
    type: Number,
    default: null
  },
  facialRecognitionVerifiedAt: {
    type: Date,
    default: null
  },

  // Email verification token flow
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationExpires: {
    type: Date,
    default: null
  },

  // Last time this account was emailed a "you were named in a report"
  // notice. Used to debounce — at most one such email per 24 hours, even
  // if several reports land the same day, so it never reads as harassment.
  lastFraudNotifiedAt: {
    type: Date,
    default: null
  },

  // Manual, staff-only action from the internal fraud dashboard — never
  // automated, never public. A suspended account can't log in, has no
  // public profile, and can't send or receive messages, but nothing about
  // *why* is ever shown anywhere outside direct contact with the recruiter
  // themselves. Reversible: unsuspending just clears both fields.
  isSuspended: {
    type: Boolean,
    default: false
  },
  suspendedAt: {
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
  
  // Profile Information (for future use)
  bio: {
    type: String,
    default: null
  },
  yearsOfExperience: {
    type: Number,
    default: null
  },
  specialties: {
    type: [String],
    default: []
  },
  profilePhotoUrl: {
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
  }
});

// Update the updatedAt field before saving
recruiterSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Recruiter', recruiterSchema);