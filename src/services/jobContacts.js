// "Who can confirm your jobs": for each unverified job on a candidate's profile, the candidate says how we may
// verify it and (optionally) names a manager, HR contact or coworker. Rules in one place so the page, the
// reminders, the weekly email and the staff screens agree.
//
// Choices (per job):
//   verify            we contact them only to confirm title and dates
//   verify_reference  same, and we also ask whether they would be willing to be a reference (nothing is shown anywhere)
//   hold              do NOT contact this employer yet; the job stays unverified until the candidate changes it
// No answer, or a choice without an email, means nobody is contacted automatically and staff verify it by hand.

const CHOICES = {
  verify: { label: 'Verify only', blurb: 'We contact them once, only to confirm your job title and dates.' },
  verify_reference: { label: 'Verify and ask for a reference', blurb: 'Same, and we also ask whether they would be willing to be a reference. Nothing about it appears on your page.' },
  hold: { label: 'Do not contact this employer yet', blurb: 'We will not reach out to anyone there until you change this. The job stays unverified.' }
};

const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com'];

const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const domainOf = (email) => String(email || '').split('@')[1] ? String(email).split('@')[1].toLowerCase() : '';
const isFreeMail = (email) => FREE_MAIL.includes(domainOf(email));

// Jobs that still need the candidate's attention: unverified, and neither put on hold nor given an email.
function needsContact(job) {
  if (!job || job.verified) return false;
  if (job.contactChoice === 'hold') return false;
  return !(job.contactChoice && job.manager && job.manager.email);
}
const missingCount = (candidate) => (candidate && candidate.workHistory ? candidate.workHistory : []).filter(needsContact).length;
const unverifiedCount = (candidate) => (candidate && candidate.workHistory ? candidate.workHistory : []).filter((j) => !j.verified).length;

// Same text the entry is matched on when the profile is saved, so a changed job cannot receive another job's answer.
const fingerprint = (j) => [j.employerName, j.jobTitle, j.startDate].map((x) => String(x || '').trim().toLowerCase()).join('|');

const clip = (v, n) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);

// form: { jobs: [{ fp, choice, name, email, phone }] } (or the flat keys the page posts, see parseForm).
// Returns { error } or { changed }, and applies the answers to the candidate's entries (does not save).
function apply(candidate, rows) {
  const jobs = candidate.workHistory || [];
  const byFp = new Map(jobs.map((j) => [fingerprint(j), j]));
  const own = String(candidate.email || '').toLowerCase();
  let changed = 0;
  for (const r of rows) {
    const job = byFp.get(String(r.fp || ''));
    if (!job || job.verified) continue;
    const choice = r.choice ? String(r.choice) : null;
    if (choice && !CHOICES[choice]) return { error: 'Pick one of the three choices for each job.' };
    const name = clip(r.name, 120); const email = clip(r.email, 200).toLowerCase(); const phone = clip(r.phone, 40);
    if (choice !== 'hold' && email) {
      if (!looksLikeEmail(email)) return { error: `That email does not look right (${email}).` };
      if (own && email === own) return { error: 'That is your own email. Enter the manager\'s or HR contact\'s work email instead.' };
    }
    const keep = choice !== 'hold' && choice !== null;
    job.contactChoice = choice;
    job.manager = { name: keep ? name : '', email: keep ? email : '', phone: keep ? phone : '' };
    changed += 1;
  }
  if (changed && typeof candidate.markModified === 'function') candidate.markModified('workHistory');
  return { changed };
}

// The page posts job_<n>_choice, job_<n>_name, ... plus job_<n>_fp.
function parseForm(body) {
  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    if (body[`job_${i}_fp`] === undefined) break;
    rows.push({ fp: body[`job_${i}_fp`], choice: body[`job_${i}_choice`] || null, name: body[`job_${i}_name`], email: body[`job_${i}_email`], phone: body[`job_${i}_phone`] });
  }
  return rows;
}

module.exports = { CHOICES, FREE_MAIL, looksLikeEmail, isFreeMail, domainOf, needsContact, missingCount, unverifiedCount, fingerprint, apply, parseForm };
