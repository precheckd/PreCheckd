const mongoose = require('mongoose');

// One attempt to verify one employment or education entry by contacting the employer or school, and (if that
// goes nowhere) the candidate. Staff start it from the verify screen. The schedule is fixed (see
// services/verificationCases.js): the candidate is told on day 0, the employer is emailed on business days
// 1, 3 and 5 and phoned on 3 and 5, and on day 7 the case opens to the candidate with a request for help.
const stepSchema = new mongoose.Schema({
  key: { type: String, required: true },                         // email1, call3, email3, call5, email5, open7
  type: { type: String, enum: ['email', 'call', 'open'], required: true },
  day: { type: Number, required: true },                         // business days after the case started
  doneAt: { type: Date, default: null },
  note: { type: String, default: '' }                            // outcome of a call, 'skipped' for a missed email
}, { _id: false });

const logSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  text: { type: String, required: true }
}, { _id: false });

const verificationCaseSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  category: { type: String, enum: ['workHistory', 'educationHistory'], required: true },
  // Snapshot of the entry, so the case still reads right if the candidate edits their profile.
  subject: { type: String, required: true },                     // employer or school
  detail: { type: String, default: '' },                         // job title or degree
  dates: { type: String, default: '' },
  contact: {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' }
  },
  status: { type: String, enum: ['outreach', 'with_candidate', 'verified', 'unable'], default: 'outreach', index: true },
  startedAt: { type: Date, default: Date.now },
  openedAt: { type: Date, default: null },                       // day 7: handed to the candidate
  closedAt: { type: Date, default: null },
  steps: { type: [stepSchema], default: [] },
  log: { type: [logSchema], default: [] },                       // staff-only history
  // Whose turn it is in the thread: 'staff' after a candidate reply, 'candidate' after ours. Null until anyone writes.
  turn: { type: String, enum: [null, 'staff', 'candidate'], default: null }
}, { timestamps: true });

module.exports = mongoose.model('VerificationCase', verificationCaseSchema);
