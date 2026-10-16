const mongoose = require('mongoose');

// One job application on a candidate's tracker (roadmap #5). Created by hand or
// from a mail suggestion the member confirmed. Status changes are always the
// member's choice (manual edit or a confirmed suggestion); the history records
// each change and which mail, if any, prompted it.
const STATUSES = ['applied', 'screening', 'interviewing', 'offer', 'rejected', 'withdrawn'];

const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  status: { type: String, enum: STATUSES, required: true },
  // 'created' = first entry; 'you' = edited by hand; 'mail' = confirmed from a mail suggestion
  by: { type: String, enum: ['created', 'you', 'mail'], default: 'you' },
  mailId: { type: mongoose.Schema.Types.ObjectId, default: null },
  note: { type: String, default: null }
}, { _id: false });

const applicationSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  company: { type: String, required: true, trim: true, maxlength: 120 },
  roleTitle: { type: String, default: '', trim: true, maxlength: 160 },
  status: { type: String, enum: STATUSES, default: 'applied' },
  appliedAt: { type: Date, default: null },

  jobUrl: { type: String, default: '', trim: true, maxlength: 500 },
  reqId: { type: String, default: '', trim: true, maxlength: 80 },
  resumeUsed: { type: String, default: '', trim: true, maxlength: 160 },
  jobDescription: { type: String, default: '', maxlength: 20000 },
  notes: { type: String, default: '', maxlength: 5000 },
  interviewAt: { type: Date, default: null },

  // Used to match later mail to this entry: the employer's own mail domain
  // (null for shared applicant-tracking-system senders) and the Message-IDs of
  // linked mail, which later replies reference in their headers.
  senderDomain: { type: String, default: null },
  messageIds: [{ type: String }],
  mailIds: [{ type: mongoose.Schema.Types.ObjectId }],

  source: { type: String, enum: ['manual', 'mail'], default: 'manual' },
  history: [historySchema],
  lastActivityAt: { type: Date, default: Date.now }
}, { timestamps: true });

applicationSchema.index({ candidateId: 1, lastActivityAt: -1 });

module.exports = mongoose.model('Application', applicationSchema);
module.exports.STATUSES = STATUSES;
