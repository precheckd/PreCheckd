const mongoose = require('mongoose');

// A candidate asking to be tested on a skill we have no test for yet. Tests are built by hand in
// CoderByte on demand, so this queue (counted per skill) tells staff what to build next.
const skillRequestSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  skill: { type: String, required: true, maxlength: 60 },   // as the candidate typed it
  key: { type: String, required: true, index: true },        // normalized, used to group and match
  status: { type: String, enum: ['requested', 'building', 'ready', 'declined'], default: 'requested' },
  readyAt: { type: Date, default: null }
}, { timestamps: true });

skillRequestSchema.index({ candidateId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('SkillRequest', skillRequestSchema);
