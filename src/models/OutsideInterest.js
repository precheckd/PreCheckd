const mongoose = require('mongoose');

// People outside the US who asked to hear if PreCheckd opens in their country.
// Used only to measure demand and send one email if we open there. Deleted after 24 months.
const schema = new mongoose.Schema({
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
  country: { type: String, required: true, trim: true, maxlength: 60 },
  who: { type: String, enum: ['candidate', 'recruiter', 'not-sure'], default: 'not-sure' },
  page: { type: String, trim: true, maxlength: 40, default: '' },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 730 }
});

module.exports = mongoose.model('OutsideInterest', schema);
