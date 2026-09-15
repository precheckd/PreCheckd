const mongoose = require('mongoose');

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
  linkedinUrl: {
    type: String,
    required: true
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