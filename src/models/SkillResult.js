const mongoose = require('mongoose');

// One row per CoderByte invite (one attempt). Holds scores only. We deliberately
// do NOT store question text, the candidate's answers, or CoderByte's report
// link: the content is theirs, answers are private, and the report link is a
// public URL containing the candidate's name and email.
//
// `inviteRef` is what we send CoderByte in place of an email address, so they
// never need the candidate's personal details. It comes back to us in webhooks
// as `email`.
const scoreSchema = new mongoose.Schema({
  name: { type: String, required: true },    // CoderByte rating name, e.g. 'AWS'
  score: { type: Number, required: true }    // 0-100, percent of that tag's questions correct
}, { _id: false });

const skillScoreSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  score: { type: Number, default: null },    // difficulty-weighted when `weighted`, else CoderByte's plain percent; null if no data
  weighted: { type: Boolean, default: false },
  level: { type: String, default: null },    // Foundational / Intermediate / Advanced / Expert
  tiers: { type: mongoose.Schema.Types.Mixed, default: null } // { easy:{right,total}, medium:{...}, hard:{...} } when weighted
}, { _id: false });

// Outcome only: question id, its tags, right or wrong. Never question text or the answer given.
const answerSchema = new mongoose.Schema({
  id: { type: String, required: true },
  correct: { type: Boolean, required: true },
  tags: { type: [String], default: [] }
}, { _id: false });

const skillResultSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  assessmentId: { type: String, required: true, index: true },
  inviteRef: { type: String, required: true, unique: true },
  status: {
    type: String,
    enum: ['invited', 'started', 'completed', 'failed'],
    default: 'invited'
  },
  inviteUrl: { type: String, default: null },  // private link, only ever shown to this candidate
  invitedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },

  // Raw per-rating percentages from CoderByte, as an array because rating names
  // can contain dots ("Node.js"), which Mongo map keys cannot.
  answers: { type: [answerSchema], default: [] },
  ratings: { type: [scoreSchema], default: [] },
  // The same data re-expressed in our skill names via SkillAssessment.skills.
  skills: { type: [skillScoreSchema], default: [] },
  overallScore: { type: Number, default: null },
  timeTakenMinutes: { type: Number, default: null },

  cheatingFlag: { type: String, default: null },
  aiUsage: { type: Boolean, default: false },
  tabLeaving: { type: Number, default: 0 },
  timeExpired: { type: Boolean, default: false },
  reportReady: { type: Boolean, default: false },
  lastError: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('SkillResult', skillResultSchema);
