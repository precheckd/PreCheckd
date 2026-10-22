const mongoose = require('mongoose');
const { EDUCATION_LEVELS, CLEARANCE_OPTIONS } = require('../content/postingOptions');

// One job posting by an agency recruiter (see docs/job-board-spec.md). Everything is a fixed choice except
// the description text. The street address is private: candidates see city and state only.
const skillReqSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  minLevel: { type: String, enum: [null, 'Foundational', 'Intermediate', 'Advanced', 'Expert'], default: null }, // null = no minimum
}, { _id: false });

const certSchema = new mongoose.Schema({
  catalogId: { type: String, required: true },
  label: { type: String, required: true },
}, { _id: false });

const certGroupSchema = new mongoose.Schema({ certs: { type: [certSchema], default: [] } }, { _id: false });

const jobPostingSchema = new mongoose.Schema({
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true, index: true },
  // open: taking applications. awaiting_outcome: close date passed, recruiter owes an outcome (step 7).
  // closed: finished. removed: taken down by staff (for example false pay information).
  status: { type: String, enum: ['open', 'awaiting_outcome', 'closed', 'removed'], default: 'open', index: true },
  // Where applicants apply. 'precheckd' = a listing here. 'external' = a job posted elsewhere that uses PreCheckd only
  // to pre-qualify applicants (a later paid service; modelled now so it needs no migration).
  source: { type: String, enum: ['precheckd', 'external'], default: 'precheckd' },
  externalUrl: { type: String, default: null },

  // Basics
  nickname: { type: String, default: '', maxlength: 60 },           // recruiter-only label, never shown to candidates
  titleId: { type: String, required: true },
  title: { type: String, required: true },                          // snapshot of the catalog title
  skills: { type: [skillReqSchema], default: [] },
  seniorityLabel: { type: String, required: true },                // derived from the skill levels, never typed
  hiringCompany: { type: String, required: true, maxlength: 100 },
  authorizedToRecruit: { type: Boolean, required: true },
  employmentType: { type: String, enum: ['full_time', 'part_time', 'contract', 'temp', 'internship'], required: true },
  contractLength: { type: String, default: '', maxlength: 60 },
  openings: { type: Number, required: true, min: 1, max: 500 },

  // Where and how
  arrangement: { type: String, enum: ['onsite', 'hybrid', 'remote', 'remote_in_area'], required: true },
  inOfficeDays: { type: Number, default: null, min: 1, max: 4 },
  areaReason: { type: String, enum: [null, 'states', 'radius'], default: null },   // Remote in Area only
  address: { type: String, default: '', maxlength: 200 },           // PRIVATE: never shown to candidates
  areaRule: {                                                      // what the apply gate checks (see utils/geo.js)
    point: { type: [Number], default: undefined },                  // [lng, lat]
    radiusMiles: { type: Number, default: undefined },
    states: { type: [String], default: undefined },
  },
  areaLabel: { type: String, default: '' },                         // "NY, NJ and CT" / "within 50 miles of Boston, MA"
  displayCity: { type: String, default: '' },                       // public
  displayState: { type: String, default: '' },                      // public
  relocation: { type: Boolean, required: true },
  travel: { type: String, enum: ['none', 'occasional', 'up_to_25', 'up_to_50', 'over_50'], required: true },
  shift: { type: String, enum: ['daytime', 'evenings', 'overnight', 'rotating', 'flexible'], required: true },

  // Pay
  basePayType: { type: String, enum: ['salary', 'hourly'], required: true },
  baseMin: { type: Number, required: true, min: 0 },
  baseMax: { type: Number, required: true, min: 0 },
  commissionOnly: { type: Boolean, default: false },                // base pay is 0
  payBasis: { type: [String], default: [] },
  commission: {
    minAnticipated: { type: Number, default: null },
    average: { type: Number, default: null },
  },
  bonus: { offered: { type: Boolean, default: false }, note: { type: String, default: '' } },
  equity: { offered: { type: Boolean, default: false }, note: { type: String, default: '' } },
  tips: { offered: { type: Boolean, default: false }, note: { type: String, default: '' } },
  benefits: { type: [String], default: [] },
  benefitsOther: { type: String, default: '', maxlength: 80 },
  noBenefits: { type: Boolean, default: false },
  goodFaithAt: { type: Date, required: true },                      // "this pay is what I actually expect to pay"
  commissionAckAt: { type: Date, default: null },                   // the commission warning, accepted

  // Requirements (all gate applications)
  education: { type: String, enum: [null, ...EDUCATION_LEVELS.map((l) => l.code)], default: null },
  certGroups: { type: [certGroupSchema], default: [] },
  clearance: { type: String, enum: [null, ...CLEARANCE_OPTIONS.map((c) => c.code)], default: null },
  startDate: { type: Date, required: true },                        // in-seat start (a calendar day, UTC midnight)
  startFirm: { type: Boolean, default: false },
  closeDate: { type: Date, required: true },                        // applications close (end of that day, New York)
  requirementsAttestedAt: { type: Date, required: true },           // "these requirements are genuinely required and lawful"

  // Description
  summary: { type: String, required: true },
  responsibilities: { type: [String], default: [] },
  team: { type: String, default: '' },
  growth: { type: String, default: '' },

  closedAt: { type: Date, default: null },
}, { timestamps: true });

jobPostingSchema.index({ status: 1, closeDate: 1 });
jobPostingSchema.index({ hiringCompany: 1 });

// The shape services/applyGate.js reads (see its header comment).
const EDU_INDEX = Object.fromEntries(EDUCATION_LEVELS.map((l) => [l.code, l.index]));
const CLR_INDEX = Object.fromEntries(CLEARANCE_OPTIONS.map((c) => [c.code, c.index]));
jobPostingSchema.methods.toGateShape = function toGateShape() {
  return {
    status: this.status,
    closeDate: this.closeDate,
    skills: this.skills.map((s) => ({ key: s.key, label: s.label, minLevel: s.minLevel })),
    education: this.education ? EDU_INDEX[this.education] : null,
    certGroups: this.certGroups.map((g) => g.certs.map((c) => ({ catalogId: c.catalogId, label: c.label }))),
    clearance: this.clearance ? CLR_INDEX[this.clearance] : null,
    shift: this.shift,
    arrangement: this.arrangement,
    areaLabel: this.areaLabel,
    areaRule: this.areaRule && (this.areaRule.point || this.areaRule.states)
      ? { point: this.areaRule.point, radiusMiles: this.areaRule.radiusMiles, states: this.areaRule.states }
      : null,
    startDate: this.startDate,
    startFirm: this.startFirm,
  };
};

module.exports = mongoose.model('JobPosting', jobPostingSchema);
