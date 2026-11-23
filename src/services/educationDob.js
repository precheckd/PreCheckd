// A date of birth is needed only so a registrar can find the right student record. It is asked when a degree is
// listed, used for the request, and deleted as soon as the candidate has no degree check still in progress.
const VerificationCase = require('../models/VerificationCase');

function validate(input, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  const years = (now - d) / (365.25 * 86400000);
  return years >= 14 && years <= 110 ? m[0] : null;
}

const hasEducation = (candidate) => (candidate.educationHistory || []).length > 0;

// Do they still have a degree that needs the DOB? An unverified entry, or a check still open.
async function stillNeeded(candidate) {
  const open = await VerificationCase.countDocuments({ candidateId: candidate._id, category: 'educationHistory', status: { $in: ['outreach', 'with_candidate'] } });
  if (open) return true;
  const closed = await VerificationCase.find({ candidateId: candidate._id, category: 'educationHistory', status: { $in: ['verified', 'unable'] } }).select('subject detail');
  const handled = new Set(closed.map((c) => `${c.subject}|${c.detail}`));
  return (candidate.educationHistory || []).some((e) => !e.verified && !handled.has(`${e.schoolName}|${e.degree}`));
}

// Deletes the DOB (and prior names) once nothing needs them. Returns true if it was deleted.
async function purgeIfDone(candidate) {
  if (!candidate.verificationDob && !candidate.verificationPriorNames) return false;
  if (await stillNeeded(candidate)) return false;
  candidate.verificationDob = null;
  candidate.verificationPriorNames = null;
  await candidate.save();
  return true;
}

// Is a DOB missing for someone who has a degree to verify? (Used to ask for it, including when a degree is added later.)
function needsDob(candidate) {
  return hasEducation(candidate) && !candidate.verificationDob && (candidate.educationHistory || []).some((e) => !e.verified);
}

module.exports = { validate, purgeIfDone, stillNeeded, needsDob, hasEducation };
