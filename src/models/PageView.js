const mongoose = require('mongoose');

// One row per (profile, viewer, calendar month) — a visitor is counted once
// per month no matter how many times they refresh. Counts only: no names are
// ever shown from this collection, and anonymous visitors are stored as a
// salted hash (never a raw IP). Powers the "views" numbers owners see on
// their own profile.
const pageViewSchema = new mongoose.Schema({
  ownerType: { type: String, enum: ['candidate', 'recruiter'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  viewerKey: { type: String, required: true },
  period: { type: String, required: true }, // 'YYYY-MM' (UTC)
  firstViewedAt: { type: Date, default: Date.now }
});

pageViewSchema.index({ ownerType: 1, ownerId: 1, viewerKey: 1, period: 1 }, { unique: true });
pageViewSchema.index({ ownerType: 1, ownerId: 1, period: 1 });

module.exports = mongoose.model('PageView', pageViewSchema);
