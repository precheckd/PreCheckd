// The Updates feed between connections. Verified facts only: no likes, comments or typed text.
//  - Candidates (opt in, default off) tell their recruiter connections about a verified certification, a verified
//    degree, or a skill level they pass AND show on their profile. Failed or hidden results never go out.
//  - A recruiter's new job reaches only the candidate connections who qualify for it (hooked in jobMatches.tell).
// Nothing here emails or rings the bell: people see updates in the feed tab and on their home page.
const FeedItem = require('../models/FeedItem');
const ConnectionRequest = require('../models/ConnectionRequest');
const { levelName } = require('../utils/levelName');

const off = () => process.env.NODE_ENV === 'test' && process.env.ENABLE_UPDATES !== 'true';
const shortName = (c) => `${c.firstName} ${(c.lastName || '').charAt(0)}.`.trim();

async function put(ownerType, ownerId, kind, text, url, key) {
  try {
    await FeedItem.create({ ownerType, ownerId, kind, text: text.slice(0, 240), url: url || null, key });
    return true;
  } catch (e) { return false; } // duplicate key: already there
}

// What a candidate could announce right now, as [{ key, kind, text }].
async function candidateFacts(candidate) {
  const name = shortName(candidate);
  const facts = [];
  for (const c of candidate.certifications || []) {
    if (c.verified && c.name) facts.push({ key: `cert:${c.name}`, kind: 'cert_verified', text: `${name} earned a verified ${c.name} certification.` });
  }
  for (const e of candidate.educationHistory || []) {
    if (e.verified && e.degree) facts.push({ key: `edu:${e.schoolName}|${e.degree}`, kind: 'edu_verified', text: `${name} had their ${e.degree} verified.` });
  }
  const skills = require('./skills');
  const hidden = new Set(candidate.hiddenSkillKeys || []);
  for (const s of await skills.currentSkills(candidate._id)) {
    if (hidden.has(s.key) || !skills.SHOWABLE.has(s.level)) continue;
    facts.push({ key: `skill:${s.key}:${s.level}${s.grandmaster ? ':gm' : ''}`, kind: 'skill_level', text: `${name} reached ${levelName(s.level, s.grandmaster)} in ${s.label}.` });
  }
  return facts;
}

// Announce anything new. With silent (or the switch off) the facts are only marked as seen, so turning the
// switch on later never dumps old history on anyone. Returns how many items were sent.
async function sweepCandidate(candidate, { silent = false } = {}) {
  if (off() || !candidate) return 0;
  try {
    const seen = new Set(candidate.announcedKeys || []);
    const fresh = (await candidateFacts(candidate)).filter((f) => !seen.has(f.key));
    if (!fresh.length) return 0;
    let sent = 0;
    if (candidate.shareUpdates && !silent) {
      const links = await ConnectionRequest.find({ candidateId: candidate._id, status: 'accepted' }).select('recruiterId');
      const recruiters = [...new Set(links.map((l) => String(l.recruiterId)))];
      for (const f of fresh) {
        for (const rid of recruiters) if (await put('recruiter', rid, f.kind, f.text, `/connections`, `${f.key}:${candidate._id}`)) sent += 1;
      }
    }
    await require('../models/Candidate').updateOne({ _id: candidate._id }, { $addToSet: { announcedKeys: { $each: fresh.map((f) => f.key) } } });
    candidate.announcedKeys = [...seen, ...fresh.map((f) => f.key)];
    return sent;
  } catch (e) { console.error('updates sweep failed:', e.message); return 0; }
}

function sweepCandidateLater(candidateId) {
  if (off()) return;
  setImmediate(async () => {
    try {
      const Candidate = require('../models/Candidate');
      await sweepCandidate(await Candidate.findById(candidateId));
    } catch (e) { console.error('updates sweep failed:', e.message); }
  });
}

// A job a candidate qualifies for, from a recruiter they are connected to.
async function jobForCandidate(candidate, posting, url) {
  if (off()) return false;
  const linked = await ConnectionRequest.exists({ candidateId: candidate._id, recruiterId: posting.recruiterId, status: 'accepted' });
  if (!linked) return false;
  return put('candidate', candidate._id, 'new_job', `A recruiter you're connected to posted ${posting.title} at ${posting.hiringCompany}. You qualify.`, url, `job:${posting._id}`);
}

async function latest(ownerType, ownerId, limit = 30) {
  const { ago } = require('./notifications');
  const [items, unread] = await Promise.all([
    FeedItem.find({ ownerType, ownerId }).sort({ createdAt: -1 }).limit(limit).lean(),
    FeedItem.countDocuments({ ownerType, ownerId, readAt: null })
  ]);
  return { unread, items: items.map((i) => ({ id: String(i._id), kind: i.kind, text: i.text, url: i.url, ago: ago(i.createdAt), unread: !i.readAt })) };
}

async function markRead(ownerType, ownerId) {
  await FeedItem.updateMany({ ownerType, ownerId, readAt: null }, { $set: { readAt: new Date() } });
}

module.exports = { sweepCandidate, sweepCandidateLater, jobForCandidate, latest, markRead, candidateFacts };
