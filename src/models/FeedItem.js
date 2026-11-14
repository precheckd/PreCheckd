const mongoose = require('mongoose');

// One line in somebody's Updates feed. Fanned out to each recipient when the event happens, so reading is a plain query.
// Only verified facts and open jobs ever land here (see services/updates.js); never text a person typed.
const feedItemSchema = new mongoose.Schema({
  ownerType: { type: String, enum: ['candidate', 'recruiter'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  kind: { type: String, required: true }, // skill_level | cert_verified | edu_verified | new_job
  text: { type: String, required: true, maxlength: 240 },
  url: { type: String, default: null },
  key: { type: String, required: true },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 60 * 60 }
});

feedItemSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
feedItemSchema.index({ ownerType: 1, ownerId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('FeedItem', feedItemSchema);
