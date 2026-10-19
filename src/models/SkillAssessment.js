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

const skillAssessmentSchema = new mongoose.Schema({
  assessmentId: { type: String, required: true, unique: true }, // CoderByte test_id
  name: { type: String, default: '' },
  publicUrl: { type: String, required: true },                  // CoderByte public_url; the invite API turns this into private links
  skills: { type: [skillSchema], default: [] },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SkillAssessment', skillAssessmentSchema);
