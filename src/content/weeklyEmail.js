// Editable content for the weekly candidate email. Add a line to WHATS_NEW
// when something ships (it shows for 4 weeks, newest first); TIPS rotate by
// week. Keep both short and true — no promises about features that aren't
// live. A what's-new item that is still current also lets the email go out on
// a week when a candidate has nothing personal to read; a tip alone never
// does.
const WHATS_NEW = [
  {
    date: '2026-10-09',
    text: 'Certification reminders: add an expiry date to a certification (or sync Credly) and we\'ll email you before it expires. Expired certifications are hidden from recruiters until you renew.'
  },
  {
    date: '2026-10-08',
    text: 'Public verification page: a link you can put in your email signature that shows you\'re verified. You choose what it shows, and it\'s off until you turn it on in Edit Profile.'
  },
  {
    date: '2026-10-08',
    text: 'Profile views: see how many people have viewed your profile, counts only, never names.'
  }
];

const TIPS = [
  'Real recruiters don\'t ask you to pay for equipment, training or background checks, or to deposit a check and send money back. If money has to come from you, walk away.',
  'Be wary of anyone who quickly wants to move the conversation to Telegram, WhatsApp or text. On PreCheckd your conversation stays where your verified identity protects you.',
  'A technical interview should never require you to clone a repository, run a script or install software you don\'t recognize. That is a common way attackers steal credentials.',
  'Don\'t share your Social Security number, bank details or ID photos before you have a written offer and have confirmed the company through an official channel. PreCheckd blocks SSNs and card numbers in messages.',
  'Check the sender\'s email domain, not just the name. A "recruiter" writing from a free webmail address or a look-alike domain deserves a second look. PreCheckd\'s Scam-check page can look it up.',
  'A very high salary for little work and no real interview is a classic scam signal. If it feels too easy, slow down and verify.'
];

const WHATS_NEW_MAX_AGE_DAYS = 28;
const WHATS_NEW_MAX_ITEMS = 3;

function currentWhatsNew(now = new Date()) {
  const cutoff = now.getTime() - WHATS_NEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return WHATS_NEW
    .filter((item) => new Date(`${item.date}T00:00:00Z`).getTime() >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, WHATS_NEW_MAX_ITEMS)
    .map((item) => item.text);
}

// ISO-ish week number (UTC) so the tip changes weekly and is stable within a week.
function tipForWeek(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const week = Math.floor((now.getTime() - start) / (7 * 24 * 60 * 60 * 1000));
  return TIPS[week % TIPS.length];
}

module.exports = { WHATS_NEW, TIPS, currentWhatsNew, tipForWeek };
