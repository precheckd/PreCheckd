const mongoose = require('mongoose');

const recruiterSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
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
  phone: {
    type: String,
    required: true
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