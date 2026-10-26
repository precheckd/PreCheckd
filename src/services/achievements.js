// Share your achievement: a public page per skill level the candidate chose to share, plus the
// share links. Nothing posts anywhere: each button opens the other site's own share window.
// The page always shows the CURRENT level from the candidate's skill summary, marked "needs retake"
// after 12 months, and disappears when the candidate stops sharing or hides the skill.
require('../utils/levelName');
const STALE_DAYS = 365;
const SHAREABLE = new Set(['Foundational', 'Intermediate', 'Advanced', 'Expert']);

function baseUrl() { return (process.env.APP_BASE_URL || 'https://precheckd.com').replace(/\/$/, ''); }
function urlFor(candidate, key) { return `${baseUrl()}/achievements/${candidate.slug}/${encodeURIComponent(key)}`; }

// Card image: one pre-made 1200x630 PNG per level (the skill name goes in the page title and text).
function cardFile(level, grandmaster) {
  if (level === 'Expert') return grandmaster ? 'grandmaster' : 'master';
  return String(level || '').toLowerCase();
}

// Returns null unless the skill is shared, shown and at a shareable level.
function publicView(candidate, key, now = Date.now()) {
  if (!candidate || !(candidate.sharedSkills || []).includes(key)) return null;
  if ((candidate.hiddenSkillKeys || []).includes(key)) return null;
  const s = (candidate.skillSummary || []).find((x) => x.key === key);
  if (!s || !SHAREABLE.has(s.level)) return null;
  const last = (candidate.lastName || '').trim().charAt(0).toUpperCase();
  const name = last ? `${candidate.firstName} ${last}.` : candidate.firstName;
  const level = global.levelName(s.level, s.grandmaster);
  return {
    name, key, skill: s.label, level, rawLevel: s.level, grandmaster: !!s.grandmaster,
    takenAt: s.takenAt, stale: !!s.takenAt && now - new Date(s.takenAt).getTime() > STALE_DAYS * 86400000,
    card: cardFile(s.level, s.grandmaster),
    headline: `${name} earned ${level} in ${s.label} on PreCheckd`
  };
}

function shareLinks(v, url) {
  const text = `I earned ${v.level} in ${v.skill} on PreCheckd.`;
  const u = encodeURIComponent(`${url}?ref=share`);
  return {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    email: `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`${text}\n\n${url}?ref=share`)}`,
    copy: `${url}?ref=share`
  };
}

// LinkedIn "Add to profile" certification link. Fields per LinkedIn's documented add-to-profile URL.
function linkedinProfileLink(v, url) {
  const d = v.takenAt ? new Date(v.takenAt) : new Date();
  const q = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME', name: `${v.level} in ${v.skill}`, organizationName: 'PreCheckd',
    issueYear: String(d.getUTCFullYear()), issueMonth: String(d.getUTCMonth() + 1), certUrl: url
  });
  return `https://www.linkedin.com/profile/add?${q.toString()}`;
}

async function setShared(candidate, key, on) {
  const cur = new Set(candidate.sharedSkills || []);
  if (on) {
    const s = (candidate.skillSummary || []).find((x) => x.key === key);
    if (!s || !SHAREABLE.has(s.level)) return false;
    cur.add(key);
  } else cur.delete(key);
  candidate.sharedSkills = [...cur];
  await candidate.save();
  return true;
}

module.exports = { publicView, shareLinks, linkedinProfileLink, setShared, urlFor, baseUrl, cardFile, SHAREABLE };
