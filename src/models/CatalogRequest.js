const mongoose = require('mongoose');

// Something a member typed that our fixed catalogs do not have yet, so staff can decide whether to add it:
//   certification - a candidate saved a certification whose name is not in src/content/certCatalog.js
//   job_title     - a recruiter picked skills for a posting and no catalog title fit
// Counted per name (like Skill Requests) so the most-asked-for items come first. Adding the item to the
// catalog file is what fixes it; marking the request "added" here is just housekeeping.
const catalogRequestSchema = new mongoose.Schema({
  kind: { type: String, enum: ['certification', 'job_title'], required: true, index: true },
  name: { type: String, required: true, maxlength: 160 },       // as typed
  key: { type: String, required: true, index: true },           // normalized, used to group
  detail: { type: String, default: '', maxlength: 400 },        // job_title: the skills the recruiter picked
  requestedByType: { type: String, enum: ['candidate', 'recruiter'], required: true },
  requestedById: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ['requested', 'added', 'declined'], default: 'requested', index: true },
}, { timestamps: true });

catalogRequestSchema.index({ kind: 1, key: 1, requestedById: 1 }, { unique: true });

module.exports = mongoose.model('CatalogRequest', catalogRequestSchema);
