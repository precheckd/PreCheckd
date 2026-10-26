const mongoose = require('mongoose');

// A half-finished job posting. The recruiter's form values are saved as typed (no validation: that happens
// when they post), each time they move to the next wizard page. Drafts expire after 30 days untouched.
const jobDraftSchema = new mongoose.Schema({
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true, index: true },
  form: { type: mongoose.Schema.Types.Mixed, default: {} },
  step: { type: Number, default: 0 },
  label: { type: String, default: '' },          // shown in the "your drafts" list
  updatedAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 30 * 86400 } }
}, { minimize: false });

module.exports = mongoose.model('JobDraft', jobDraftSchema);
