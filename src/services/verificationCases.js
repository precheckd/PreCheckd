// Verification cases: a fixed, one-person-friendly routine for verifying an employment or education entry.
//
//   day 0   case started: candidate gets a "we're checking" message in their PreCheckd inbox
//   day 1   email the employer/school (automatic, if a contact email is saved)
//   day 3   email (automatic) + phone call (staff, logged)
//   day 5   email (automatic) + phone call (staff, logged)
//   day 7   still unconfirmed: the case opens to the candidate with a request for help
//
// Days are weekdays in New York time. Staff resolve a case at any point as verified (the entry is marked
// verified on the profile) or unable to verify (neutral: it never counts against the candidate).
// Everything the candidate is asked happens in their PreCheckd inbox; email is only ever a generic nudge.
const VerificationCase = require('../models/VerificationCase');
const Candidate = require('../models/Candidate');
const Message = require('../models/Message');
const { notify } = require('./notifications');
const { businessDaysSince } = require('../utils/businessTime');
const { checkOutgoing } = require('../utils/messageSafety');

const OPEN_DAY = 7;
const SCHEDULE = [
  { key: 'email1', type: 'email', day: 1 },
  { key: 'email3', type: 'email', day: 3 },
  { key: 'call3', type: 'call', day: 3 },
  { key: 'email5', type: 'email', day: 5 },
  { key: 'call5', type: 'call', day: 5 },
  { key: 'open7', type: 'open', day: OPEN_DAY }
];
const MAX_FILES_PER_MESSAGE = 2;
const MAX_FILES_PER_CASE = 6;
const KEEP_FILES_DAYS = 30;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_TYPES = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const NO_SENSITIVE = 'Please do not send Social Security, card or bank account numbers here.';
const REDACT = 'Black out your Social Security number, pay amounts and account numbers first; we only need your name, the school or employer, and the dates.';
const fail = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
const isWork = (c) => c.category === 'workHistory';
const noun = (c) => (isWork(c) ? 'employment' : 'education');

// Candidate-facing wording. Kept plain; never says anything about what the employer did or didn't say.
const TEXT = {
  start: (c) => `We've started verifying your ${isWork(c) ? `${c.detail ? c.detail + ' role' : 'role'} at` : `${c.detail ? c.detail + ' at' : 'time at'}`} ${c.subject}. This usually takes up to 7 business days and you don't need to do anything. If you know a good contact, such as ${isWork(c) ? 'someone in HR or a former manager' : 'the registrar or records office'}, you can reply here with their name and email or phone to speed it up. ${NO_SENSITIVE}`,
  open: (c) => isWork(c)
    ? `We haven't been able to confirm your time at ${c.subject} yet, and we could use your help. Could you reply with:\n\n1. The name and email or phone of someone in HR or payroll there, or a former manager who can confirm your dates\n2. Your exact start and end dates, if the ones on your profile are approximate\n3. Any other name you used while you worked there\n\nIf you have a document that shows it, such as an offer letter, you can attach it below. ${REDACT} ${NO_SENSITIVE}`
    : `We haven't been able to confirm your time at ${c.subject} yet, and we could use your help. Could you reply with:\n\n1. The name and email or phone of the registrar or records office\n2. Your exact graduation date, if the one on your profile is approximate\n3. Any other name you used while you were enrolled\n\nIf you have a document that shows it, such as a diploma or transcript, you can attach it below. ${REDACT} ${NO_SENSITIVE}`,
  docs: (c) => isWork(c)
    ? `If it's easier, you can attach a document that shows your time at ${c.subject}, such as an offer letter or a pay stub. ${REDACT} Use the attach button below your reply.`
    : `If it's easier, you can attach a document that shows your time at ${c.subject}, such as a diploma or transcript. ${REDACT} Use the attach button below your reply.`,
  verified: (c) => `Good news: your ${noun(c)} at ${c.subject} is now verified and shows as verified on your profile.`,
  unable: (c) => `We weren't able to confirm your ${noun(c)} at ${c.subject}. It stays on your profile as unverified, and this doesn't count against you. If you can get us a new contact for them, reply here and we'll try again.`
};

const logLine = (c, text) => { c.log.push({ at: new Date(), text }); };

// ---- sending into the candidate's inbox --------------------------------

async function toCandidate(c, text) {
  const cand = await Candidate.findById(c.candidateId);
  if (!cand) return null;
  const m = await Message.create({ verificationCaseId: c._id, senderType: 'system', recipientType: 'candidate', recipientId: cand._id, body: text });
  c.turn = 'candidate';
  await notify('candidate', cand._id, 'verification', 'You have a message from PreCheckd Verification', `/messages/verification/${c._id}`);
  if (cand.email) {
    try { await require('./emailService').sendVerificationNoticeEmail(cand.email, cand.firstName, c._id); }
    catch (e) { console.error('[verification] candidate email failed:', e.message); }
  }
  return m;
}

// ---- starting ----------------------------------------------------------

function snapshot(candidate, category, index) {
  const e = (candidate[category] || [])[index];
  if (!e) throw fail('no_entry', 'Entry not found');
  return category === 'workHistory'
    ? { subject: e.employerName, detail: e.jobTitle, dates: `${e.startDate || '?'} to ${e.endDate || 'present'}`, verified: e.verified }
    : { subject: e.schoolName, detail: e.degree, dates: e.graduationDate || '', verified: e.verified };
}

// Throws .code: no_entry | already_verified | exists.
async function start(candidate, category, index, contact = {}) {
  if (!['workHistory', 'educationHistory'].includes(category)) throw fail('no_entry');
  const snap = snapshot(candidate, category, index);
  const k = cleanContact(contact);
  if (k.email && !looksLikeEmail(k.email)) throw fail('bad_email', 'That email does not look right');
  if (snap.verified) throw fail('already_verified', 'Already verified');
  const open = await VerificationCase.findOne({ candidateId: candidate._id, category, subject: snap.subject, detail: snap.detail, status: { $in: ['outreach', 'with_candidate'] } });
  if (open) throw fail('exists', 'A case is already open for this entry');
  const c = await VerificationCase.create({
    candidateId: candidate._id, category, subject: snap.subject, detail: snap.detail, dates: snap.dates,
    contact: cleanContact(contact), status: 'outreach', startedAt: new Date(),
    steps: SCHEDULE.map((s) => ({ ...s, doneAt: null, note: '' }))
  });
  logLine(c, 'Case started');
  await toCandidate(c, TEXT.start(c));
  await c.save();
  return c;
}

function cleanContact(x = {}) {
  const t = (v, n) => String(v || '').trim().slice(0, n);
  return { name: t(x.name, 120), email: t(x.email, 200).toLowerCase(), phone: t(x.phone, 40) };
}
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function saveContact(c, contact) {
  const k = cleanContact(contact);
  if (k.email && !looksLikeEmail(k.email)) throw fail('bad_email', 'That email does not look right');
  c.contact = k;
  logLine(c, 'Contact saved');
  await c.save();
  return c;
}

// ---- the routine -------------------------------------------------------

const dayOf = (c, now = Date.now()) => businessDaysSince(c.startedAt, now);
const dueSteps = (c, now) => (c.status === 'outreach' ? c.steps.filter((s) => !s.doneAt && s.day <= dayOf(c, now)) : []);

// What staff should do next on a case.
function nextAction(c, now = Date.now()) {
  if (['verified', 'unable'].includes(c.status)) return { label: 'Closed', kind: 'closed' };
  if (c.turn === 'staff') return { label: 'Candidate replied: your turn', kind: 'reply' };
  if (c.status === 'with_candidate') return { label: 'Waiting on the candidate', kind: 'wait' };
  const due = dueSteps(c, now);
  const call = due.find((s) => s.type === 'call');
  if (call) return { label: `Call today (day ${call.day} call)`, kind: 'call' };
  const email = due.find((s) => s.type === 'email');
  if (email && !c.contact.email) return { label: 'Add an employer email so the day ' + email.day + ' email can go out', kind: 'contact' };
  const next = c.steps.filter((s) => !s.doneAt).sort((a, b) => a.day - b.day)[0];
  return { label: next ? `Next: day ${next.day} ${next.type === 'open' ? 'opens to the candidate' : next.type}` : 'Waiting', kind: 'wait' };
}

// Hourly: send due emails (one per case per run, earlier ones marked skipped), open cases that hit day 7.
async function runDue(now = Date.now()) {
  const counts = { emails: 0, opened: 0 };
  const cases = await VerificationCase.find({ status: 'outreach' });
  for (const c of cases) {
    const due = dueSteps(c, now);
    const emails = due.filter((s) => s.type === 'email');
    if (emails.length && c.contact.email) {
      const latest = emails[emails.length - 1];
      for (const s of emails) { s.doneAt = new Date(now); if (s !== latest) s.note = 'skipped'; }
      const cand = await Candidate.findById(c.candidateId);
      try {
        await require('./emailService').sendEmployerVerificationEmail({
          to: c.contact.email, contactName: c.contact.name, kind: c.category, candidateName: cand ? `${cand.firstName} ${cand.lastName || ''}`.trim() : 'A PreCheckd member',
          subject: c.subject, detail: c.detail, dates: c.dates, attempt: c.steps.filter((s) => s.type === 'email' && s.doneAt).length
        });
        logLine(c, `Emailed ${c.contact.email} (day ${latest.day})`);
        counts.emails++;
      } catch (e) {
        latest.doneAt = null; // try again next hour
        console.error('[verification] employer email failed:', e.message);
      }
    }
    const open = due.find((s) => s.type === 'open');
    if (open && !open.doneAt) {
      open.doneAt = new Date(now);
      c.status = 'with_candidate';
      c.openedAt = new Date(now);
      logLine(c, 'Day 7: opened to the candidate');
      await toCandidate(c, TEXT.open(c));
      counts.opened++;
    }
    await c.save();
  }
  return counts;
}

// ---- staff actions -----------------------------------------------------

const OUTCOMES = { reached: 'Reached someone', voicemail: 'Left a voicemail', none: 'No answer', wrong: 'Wrong or dead number' };

// Marks the earliest due call done and records what happened.
async function logCall(c, outcome) {
  if (!OUTCOMES[outcome]) throw fail('invalid', 'Pick an outcome');
  const step = dueSteps(c).find((s) => s.type === 'call') || c.steps.find((s) => s.type === 'call' && !s.doneAt);
  if (step) { step.doneAt = new Date(); step.note = OUTCOMES[outcome]; }
  logLine(c, `Call: ${OUTCOMES[outcome]}`);
  await c.save();
  return c;
}

async function note(c, text) {
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) throw fail('invalid', 'Write a note');
  logLine(c, `Note: ${t}`);
  await c.save();
  return c;
}

async function openNow(c) {
  if (c.status !== 'outreach') throw fail('invalid', 'Already with the candidate');
  c.status = 'with_candidate'; c.openedAt = new Date();
  const open = c.steps.find((s) => s.type === 'open'); if (open) open.doneAt = new Date();
  logLine(c, 'Opened to the candidate early');
  await toCandidate(c, TEXT.open(c));
  await c.save();
  return c;
}

async function staffReply(c, body) {
  const text = String(body || '').trim();
  if (!text) throw fail('empty', 'Write a message');
  await toCandidate(c, text.slice(0, 4000));
  logLine(c, 'Messaged the candidate');
  await c.save();
  return c;
}

// Marks the matching profile entry verified (matched by name and title, not position) and tells the candidate.
async function resolve(c, outcome) {
  if (!['verified', 'unable'].includes(outcome)) throw fail('invalid');
  if (['verified', 'unable'].includes(c.status)) throw fail('closed', 'Already closed');
  const cand = await Candidate.findById(c.candidateId);
  if (outcome === 'verified' && cand) {
    const e = (cand[c.category] || []).find((x) => (isWork(c) ? x.employerName === c.subject && x.jobTitle === c.detail : x.schoolName === c.subject && x.degree === c.detail));
    if (e) { e.verified = true; e.verifiedAt = new Date(); cand.markModified(c.category); await cand.save(); }
    else logLine(c, 'Profile entry not found (edited since?): mark it verified by hand');
  }
  c.status = outcome; c.closedAt = new Date(); c.turn = null;
  logLine(c, outcome === 'verified' ? 'Verified' : 'Closed: unable to verify');
  await toCandidate(c, TEXT[outcome](c));
  c.turn = null;
  await c.save();
  return c;
}

// ---- candidate side ----------------------------------------------------

async function ownCase(candidateId, id) {
  const c = await VerificationCase.findOne({ _id: id, candidateId }).catch(() => null);
  if (!c) throw fail('not_found', 'Not found');
  return c;
}

async function thread(candidateId, id) {
  const c = await ownCase(candidateId, id);
  const messages = await Message.find({ verificationCaseId: c._id }).sort({ sentAt: 1 });
  await Message.updateMany({ verificationCaseId: c._id, recipientType: 'candidate', readAt: null }, { readAt: new Date() });
  return { c, messages };
}

// Recognizes the real file type from its first bytes, so a renamed file can't slip through.
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(1, 4).toString('latin1') === 'PNG' && buf[0] === 0x89) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const safeName = (n) => String(n || 'document').split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, '').slice(0, 80) || 'document';

// Throws .code: not_found | empty | unsafe | closed | too_many | bad_file | too_big.
// A message needs text or a file. Files go to private storage and are never linked from the candidate's profile.
async function candidateReply(candidate, id, body, files = []) {
  const c = await ownCase(candidate._id, id);
  const text = String(body || '').trim();
  files = (files || []).filter(Boolean);
  if (!text && !files.length) throw fail('empty');
  if (text) { const unsafe = checkOutgoing(text); if (unsafe) throw fail('unsafe', unsafe.message); }
  if (c.status === 'verified') throw fail('closed');
  const attachments = [];
  if (files.length) {
    if (files.length > MAX_FILES_PER_MESSAGE) throw fail('too_many');
    const prior = (await Message.find({ verificationCaseId: c._id })).reduce((n, m) => n + (m.attachments || []).length, 0);
    if (prior + files.length > MAX_FILES_PER_CASE) throw fail('too_many');
    for (const f of files) {
      if (!f.buffer || f.size > MAX_FILE_BYTES || f.buffer.length > MAX_FILE_BYTES) throw fail('too_big');
      const type = sniff(f.buffer);
      if (!type || !FILE_TYPES[type]) throw fail('bad_file');
    }
    const s3 = require('../utils/s3Upload');
    for (const f of files) {
      const type = sniff(f.buffer);
      const key = await s3.uploadPrivateDocument('verification-docs', String(c._id), { buffer: f.buffer, mimetype: type }, FILE_TYPES[type]);
      attachments.push({ key, name: safeName(f.originalname), mime: type, size: f.buffer.length });
    }
  }
  await Message.create({ verificationCaseId: c._id, senderType: 'candidate', senderId: candidate._id, recipientType: 'system', body: (text || '(attached a file)').slice(0, 4000), attachments });
  c.turn = 'staff';
  // A reply after "unable to verify" means they have something new: it goes back in the queue.
  if (c.status === 'unable') { c.status = 'with_candidate'; c.closedAt = null; logLine(c, 'Candidate replied after closing: reopened'); }
  else logLine(c, attachments.length ? `Candidate replied with ${attachments.length} file${attachments.length === 1 ? '' : 's'}` : 'Candidate replied');
  await c.save();
  try {
    await require('./emailService').sendStaffAlertEmail({
      subject: 'Verification reply waiting', headline: 'A candidate replied on a verification case',
      paragraphs: [`${candidate.firstName} ${candidate.lastName || ''} replied about ${c.subject}.`.trim()],
      buttonUrl: `https://${process.env.ADMIN_HOSTNAME || 'admin.precheckd.com'}/verification-cases/${c._id}`, buttonLabel: 'Open the case'
    });
  } catch (e) { console.error('[verification] staff alert failed:', e.message); }
  return c;
}

// ---- documents (staff side) --------------------------------------------

// The stored file behind a link on the case page, or null.
async function fileFor(caseId, messageId, index) {
  const m = await Message.findById(messageId).catch(() => null);
  if (!m || String(m.verificationCaseId) !== String(caseId)) return null;
  return (m.attachments || [])[Number(index)] || null;
}

async function deleteFile(c, messageId, index) {
  const m = await Message.findById(messageId).catch(() => null);
  if (!m || String(m.verificationCaseId) !== String(c._id) || !(m.attachments || [])[Number(index)]) throw fail('not_found');
  const [f] = m.attachments.splice(Number(index), 1);
  await require('../utils/s3Upload').deletePrivateObject(f.key);
  await m.save();
  logLine(c, `Deleted file ${f.name}`);
  await c.save();
  return c;
}

// Hourly: documents are kept for KEEP_FILES_DAYS after a case closes, then removed.
async function purgeOldFiles(now = Date.now()) {
  const cutoff = now - KEEP_FILES_DAYS * 86400000;
  const closed = await VerificationCase.find({ status: { $in: ['verified', 'unable'] } });
  let n = 0;
  for (const c of closed) {
    if (!c.closedAt || c.closedAt.getTime() > cutoff) continue;
    const msgs = await Message.find({ verificationCaseId: c._id });
    let here = 0;
    for (const m of msgs) {
      if (!(m.attachments || []).length) continue;
      for (const f of m.attachments) { await require('../utils/s3Upload').deletePrivateObject(f.key); here++; }
      m.attachments = []; await m.save();
    }
    if (here) { n += here; logLine(c, 'Documents removed (30 days after closing)'); await c.save(); }
  }
  return n;
}

// Mail page rows: one per case, most recent message first.
async function inboxRows(candidateId) {
  const cases = await VerificationCase.find({ candidateId });
  const rows = [];
  for (const c of cases) {
    const msgs = await Message.find({ verificationCaseId: c._id }).sort({ sentAt: -1 });
    if (!msgs.length) continue;
    const unread = msgs.filter((m) => m.recipientType === 'candidate' && !m.readAt).length;
    rows.push({ id: String(c._id), subject: c.subject, last: msgs[0], unread });
  }
  return rows;
}

// Daily staff digest: what needs doing today.
async function digestSummary(now = Date.now()) {
  const cases = await VerificationCase.find({ status: { $in: ['outreach', 'with_candidate'] } });
  const acts = cases.map((c) => nextAction(c, now));
  return { open: cases.length, calls: acts.filter((a) => a.kind === 'call').length, replies: acts.filter((a) => a.kind === 'reply').length, contacts: acts.filter((a) => a.kind === 'contact').length };
}
async function sendDigest() {
  const d = await digestSummary();
  if (!d.calls && !d.replies && !d.contacts) return 0;
  await require('./emailService').sendStaffAlertEmail({
    subject: 'Verification cases: today', headline: 'Verification cases needing you today',
    paragraphs: [`${d.calls} call${d.calls === 1 ? '' : 's'} due, ${d.replies} candidate repl${d.replies === 1 ? 'y' : 'ies'} waiting, ${d.contacts} missing a contact email. ${d.open} open in all.`],
    buttonUrl: `https://${process.env.ADMIN_HOSTNAME || 'admin.precheckd.com'}/verification-cases`, buttonLabel: 'Open the queue'
  });
  return d.calls + d.replies + d.contacts;
}

module.exports = { MAX_FILES_PER_MESSAGE, MAX_FILES_PER_CASE, KEEP_FILES_DAYS, sniff, fileFor, deleteFile, purgeOldFiles, OPEN_DAY, SCHEDULE, OUTCOMES, TEXT, start, saveContact, dayOf, dueSteps, nextAction, runDue, logCall, note, openNow, staffReply, resolve, thread, candidateReply, inboxRows, digestSummary, sendDigest };
