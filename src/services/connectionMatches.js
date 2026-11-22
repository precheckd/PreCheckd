// "Connections who already qualify": for one of a recruiter's postings, which of their connections can apply right
// now, and inviting them to apply.
//
// Qualifying uses the same apply gate as the Apply button, with ONE difference: only skills the candidate shows
// to recruiters count. A skill a candidate hides (or a Developing/Provisional result, which is never shown) must not
// leak through a "qualifies" answer, so a candidate who would qualify only through a hidden skill is left off this
// list. They still get the automatic "You qualify" notice and can apply themselves.
const ConnectionRequest = require('../models/ConnectionRequest');
const JobApplication = require('../models/JobApplication');
const JobInvite = require('../models/JobInvite');
const { evaluate } = require('./applyGate');
const { toFacts, loadSkillFacts } = require('./applyFacts');
const { notify } = require('./notifications');

const SHOWABLE = new Set(['Foundational', 'Intermediate', 'Advanced', 'Expert']);
const MAX_PER_INVITE = 100;

// A withdrawal forced by a requirement change does not count as "already applied" (same rule as the job notices).
const stillApplied = (a) => !(a.status === 'withdrawn' && a.withdrawnBy === 'requirement_change');

function visibleSkills(skills, candidate) {
  const hidden = new Set(candidate.hiddenSkillKeys || []);
  return skills.filter((s) => !hidden.has(s.key) && SHOWABLE.has(s.level) && !s.reviewing);
}

// Pure: can this candidate apply, counting only skills they show?
function qualifies(candidate, skills, posting, now = Date.now()) {
  const gate = posting.toGateShape();
  return evaluate(toFacts(candidate, { skills: visibleSkills(skills, candidate), posting: gate }), gate, now).canApply;
}

// Returns { qualifying: [{ connection, candidate }], invited: Set(candidateId strings) }.
async function forPosting(recruiterId, posting, { now = Date.now(), loadSkills = loadSkillFacts } = {}) {
  const [connections, applied, invites] = await Promise.all([
    ConnectionRequest.find({ recruiterId, status: 'accepted' }).populate('candidateId'),
    JobApplication.find({ jobId: posting._id }),
    JobInvite.find({ postingId: posting._id }),
  ]);
  const done = new Set(applied.filter(stillApplied).map((a) => String(a.candidateId)));
  const invited = new Set(invites.map((i) => String(i.candidateId)));
  const qualifying = [];
  for (const connection of connections) {
    const candidate = connection.candidateId;
    if (!candidate || candidate.openToOpportunities === false) continue;
    if (!candidate.isPhoneVerified || !candidate.isIdentityVerified) continue;
    const id = String(candidate._id);
    if (done.has(id) || invited.has(id)) continue;
    try {
      if (qualifies(candidate, await loadSkills(candidate._id, now), posting, now)) qualifying.push({ connection, candidate });
    } catch (e) { console.error('Connection match failed for one candidate:', e.message); }
  }
  return { qualifying, invited };
}

// Sends the invite to each chosen connection that STILL qualifies (the list is recomputed here; the browser's
// choice is never trusted). Returns { sent, skipped }.
async function invite(recruiter, posting, connectionIds, { url, sendMessage, now = Date.now(), loadSkills } = {}) {
  const wanted = new Set((connectionIds || []).map(String));
  const { qualifying } = await forPosting(recruiter._id, posting, { now, loadSkills });
  let sent = 0;
  let skipped = 0;
  for (const { connection, candidate } of qualifying) {
    if (!wanted.has(String(connection._id))) continue;
    if (sent >= MAX_PER_INVITE) { skipped += 1; continue; }
    try { await JobInvite.create({ postingId: posting._id, recruiterId: recruiter._id, candidateId: candidate._id, connectionId: connection._id }); } catch (e) { skipped += 1; continue; } // already invited
    const r = await sendMessage(connection, `I'd like to invite you to apply for ${posting.title} at ${posting.hiringCompany}. It looks like you meet the requirements. ${url}`);
    if (r && r.error) { await JobInvite.deleteOne({ postingId: posting._id, candidateId: candidate._id }); skipped += 1; continue; }
    await notify('candidate', candidate._id, 'job_invite', `A recruiter invited you to apply for ${posting.title}.`.slice(0, 200), url.replace(/^https?:\/\/[^/]+/, ''));
    sent += 1;
  }
  return { sent, skipped: skipped + [...wanted].filter((id) => !qualifying.some((q) => String(q.connection._id) === id)).length };
}

module.exports = { forPosting, invite, qualifies, visibleSkills, MAX_PER_INVITE };
