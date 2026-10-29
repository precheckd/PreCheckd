const mongoose = require('mongoose');

// One row per question asked on the /ask assistant. Kept so staff can see what
// people ask (and where the assistant fell short) and so the daily spend cap
// has real numbers to add up. No account is attached: visitors are stored as a
// salted hash of their IP, never the raw address. Rows delete themselves after
// 90 days.
const chatLogSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  visitorHash: { type: String, required: true },
  question: { type: String, required: true },
  answer: { type: String, default: '' },
  // True when the assistant said it didn't have the answer (a gap in the facts file).
  noAnswer: { type: Boolean, default: false },
  // True when the call failed (API error, timeout) and the visitor saw the fallback message.
  failed: { type: Boolean, default: false },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  costUsd: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

chatLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('ChatLog', chatLogSchema);
