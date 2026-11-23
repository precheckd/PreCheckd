// The school directory: where a verification request for a degree goes. A candidate picks their school from here,
// so the address always comes from us and never from what someone typed.
//   confirmed       a human replied from this address, or it was copied from the school's own site
//   guessed         a pattern address (registrar@domain) on a domain that accepts mail; not yet answered by a person
//   needs_research  no usable address; staff find one before anything is sent
const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, index: true },
  ipedsId: { type: String, default: null, index: { unique: true, sparse: true } },
  domain: { type: String, default: '', lowercase: true, trim: true },
  registrarEmail: { type: String, default: '', lowercase: true, trim: true },
  registrarPhone: { type: String, default: '', trim: true },
  emailStatus: { type: String, enum: ['confirmed', 'guessed', 'needs_research'], default: 'needs_research' },
  sourceUrl: { type: String, default: '' },
  checkedAt: { type: Date, default: null },
  notes: { type: String, default: '', maxlength: 500 },
  // True when a candidate typed a school we did not know; staff research it.
  addedByCandidate: { type: Boolean, default: false },
}, { timestamps: true });

const keyOf = (n) => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
schoolSchema.pre('validate', function setKey(next) { this.nameKey = keyOf(this.name); next(); });
schoolSchema.statics.keyOf = keyOf;

module.exports = mongoose.model('School', schoolSchema);
