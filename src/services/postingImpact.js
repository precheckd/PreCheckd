// What an edit does to the people who already applied (Kent, Oct 22; docs/job-board-spec.md section 11):
//  - an edit that adds or tightens a requirement WITHDRAWS the applicants who no longer meet it, with a message
//    saying what changed and how to fix it; the recruiter confirms the count first;
//  - any other change withdraws no one, and every current applicant is told what changed.
// "No longer meets it" means: fails a requirement under the new posting that they did not already fail under
// the old one, so an unrelated edit never sweeps up someone whose own situation drifted.
const { evaluate } = require('./applyGate');
const { buildCandidateFacts } = require('./applyFacts');
const { notify } = require('./notifications');
const { withdrawApplication, activeApplicants } = require('./jobApplications');
const Candidate = require('../models/Candidate');
const JobNotice = require('../models/JobNotice');

const REQUIREMENT = new Set(['skill', 'education', 'certification', 'clearance', 'shift', 'area', 'availability']);

function keyOf(b) {
  return [b.criterion, b.skillKey || (b.group != null ? 'g' + b.group : ''), b.code].join(':');
}
function requirementBlockers(result) { return result.blockers.filter((b) => REQUIREMENT.has(b.criterion)); }

// oldGate / newGate: posting.toGateShape() before and after. Returns { withdraw: [{app, blockers}], keep: [app] }.
async function analyseEdit(oldGate, newGate, now = Date.now()) {
  const apps = await activeApplicants(newGate.jobId || oldGate.jobId);
  const withdraw = []; const keep = [];
  for (const app of apps) {
    const candidate = await Candidate.findById(app.candidateId);
    if (!candidate) { keep.push(app); continue; }
    const before = evaluate(await buildCandidateFacts(candidate, { posting: oldGate }), oldGate, now);
    const after = evaluate(await buildCandidateFacts(candidate, { posting: newGate }), newGate, now);
    const had = new Set(requirementBlockers(before).map(keyOf));
    const fresh = requirementBlockers(after).filter((b) => !had.has(keyOf(b)));
    if (fresh.length) withdraw.push({ app, blockers: fresh }); else keep.push(app);
  }
  return { withdraw, keep };
}

// Carries out the result once the edit is saved.
async function applyImpact(posting, impact, parts, now = new Date()) {
  const url = `/jobs/${posting._id}`;
  for (const { app, blockers } of impact.withdraw) {
    const why = blockers.map((b) => b.message.replace(/ Add it to your profile, or withdraw\.| Renew it and update your profile, or withdraw\.| or withdraw\.?$/g, '')).join(' ');
    await withdrawApplication(app, { by: 'requirement_change', note: why }, now);
    // forget the earlier "you qualify" notice, so they are told again when they meet the new requirement
    await JobNotice.deleteOne({ candidateId: app.candidateId, jobId: app.jobId });
    await notify('candidate', app.candidateId, 'job_withdrawn',
      `Your application for ${posting.title} was withdrawn because its requirements changed. See what to fix.`.slice(0, 200), url);
  }
  const what = parts.filter((p) => p !== 'company').join(', ') || 'details';
  for (const app of impact.keep) {
    await notify('candidate', app.candidateId, 'job_updated', `${posting.title} at ${posting.hiringCompany} was updated (${what}).`.slice(0, 200), url);
  }
}

module.exports = { analyseEdit, applyImpact, keyOf };
