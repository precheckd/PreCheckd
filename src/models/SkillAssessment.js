const mongoose = require('mongoose');

// One row per CoderByte assessment we have built in their dashboard. Their API
// cannot create assessments or edit questions, so every assessment we offer is
// built by hand there first and registered here.
//
// `skills` maps OUR skill names to the rating names CoderByte reports back
// (they differ: we say "Cloud", their report says "AWS"; "Linux" also brings
// "Unix"). A skill's score is the average of whichever of its ratingKeys the
// report contains.
const skillSchema = new mongoose.Schema({
  key: { type: String, required: true },     // our slug, e.g. 'cloud'
  label: { type: String, required: true },   // shown to people, e.g. 'Cloud'
  ratingKeys: { type: [String], default: [] }
}, { _id: false });

// Difficulty per question, keyed by CoderByte's question id (the `id` in each
// report's mc_details). CoderByte's API does not expose difficulty, so we copy it
// from their question library (sets are labelled Easy/Medium/Hard) when building
// an assessment. Skills whose questions are not all mapped fall back to the plain
// CoderByte percentage and are flagged `weighted: false`.
const questionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true }
}, { _id: false });

const skillAssessmentSchema = new mongoose.Schema({
  assessmentId: { type: String, required: true, unique: true }, // CoderByte test_id
  name: { type: String, default: '' },
  // 'skill': our own controlled module (3/3/3 per skill); results become skill levels.
  // 'title': a CoderByte job-title test with a mix we don't control; results are shown as an exact
  // score in their own box and never feed skill levels.
  kind: { type: String, enum: ['skill', 'title'], default: 'skill' },
  publicUrl: { type: String, required: true },                  // CoderByte public_url; the invite API turns this into private links
  skills: { type: [skillSchema], default: [] },
  questions: { type: [questionSchema], default: [] },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SkillAssessment', skillAssessmentSchema);
