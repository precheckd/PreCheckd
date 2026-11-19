const mongoose = require('mongoose');

// Daily visit counters per tagged link (for example precheckd.com/go/li-dm). Counts only: no IP address, no visitor
// identity. One row per tag, target and day.
const sourceVisitSchema = new mongoose.Schema({
  src: { type: String, required: true },
  target: { type: String, enum: ['demo', 'site'], required: true },
  day: { type: String, required: true }, // YYYY-MM-DD, Eastern time
  count: { type: Number, default: 0 },
});
sourceVisitSchema.index({ src: 1, target: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('SourceVisit', sourceVisitSchema);
