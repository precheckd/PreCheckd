const mongoose = require('mongoose');

// A running note kept by staff about a candidate or a recruiter: what happened, when. Never shown to anyone but
// staff. A note written on a verification case carries that case's id, so it shows on the case and on the person's
// timeline. kind: note, call (with an outcome) or conduct (possible improper behavior, shown with a red badge).
// Deleted with the account (services/accountDeletion.js).
const staffNoteSchema = new mongoose.Schema({
  subjectType: { type: String, enum: ['candidate', 'recruiter'], required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'VerificationCase', default: null },
  kind: { type: String, enum: ['note', 'call', 'conduct'], default: 'note' },
  outcome: { type: String, enum: ['', 'reached', 'voicemail', 'none', 'wrong'], default: '' },
  text: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

staffNoteSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });
staffNoteSchema.index({ caseId: 1, createdAt: -1 });
staffNoteSchema.index({ kind: 1, createdAt: -1 });

module.exports = mongoose.model('StaffNote', staffNoteSchema);
