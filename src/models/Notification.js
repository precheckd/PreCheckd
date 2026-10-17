const mongoose = require('mongoose');

// A one-line "what happened" item for the header bell. Titles are generic by
// design: never message text, never anything a recipient hasn't earned seeing.
const notificationSchema = new mongoose.Schema({
  ownerType: { type: String, enum: ['candidate', 'recruiter'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, required: true },
  title: { type: String, required: true, maxlength: 200 },
  url: { type: String, default: '/connections' },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, expires: 60 * 24 * 60 * 60 }
});

notificationSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
