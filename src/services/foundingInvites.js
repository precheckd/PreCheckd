// Invite codes for the free founding year (first 100 recruiters, invite only). A code is single use. People can also
// ask for one; staff approve each request, which makes the code and emails the join link.
const crypto = require('crypto');
const FoundingInvite = require('../models/FoundingInvite');

// No 0/O/1/I/L so a code read aloud or typed from an email is hard to get wrong.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const base = () => process.env.APP_BASE_URL || 'https://precheckd.com';
const joinUrl = (code) => `${base()}/join/${code}`;

function generateCode() {
  let out = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Pure: what a person typed -> the code, or '' when it cannot be one.
function cleanCode(v) {
  const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : '';
}

async function makeUniqueCode() {
  for (let i = 0; i < 8; i += 1) {
    const code = generateCode();
    if (!(await FoundingInvite.exists({ code }))) return code;
  }
  throw new Error('Could not make a unique invite code');
}

// Staff: a code to send to someone they contacted directly.
async function createForStaff({ note = '', email = '' } = {}) {
  return FoundingInvite.create({ code: await makeUniqueCode(), status: 'open', source: 'staff', note: String(note).slice(0, 300), email: String(email).trim().toLowerCase().slice(0, 160) });
}

// The invite a code points to, only if it can still be used.
async function findUsable(codeInput) {
  const code = cleanCode(codeInput);
  if (!code) return null;
  return FoundingInvite.findOne({ code, status: 'open' });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// A visitor asking for an invite. One open ask per email; asking again is quietly accepted without a second row.
async function submitRequest({ name, email, company, about }) {
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').trim();
  if (!n || n.length > 120) { const err = new Error('Enter your name.'); err.code = 'bad_name'; throw err; }
  if (!EMAIL_RE.test(e) || e.length > 160) { const err = new Error('Enter a valid email.'); err.code = 'bad_email'; throw err; }
  const existing = await FoundingInvite.findOne({ email: e, source: 'request', status: { $in: ['requested', 'open'] } });
  if (existing) return { created: false, invite: existing };
  const invite = await FoundingInvite.create({
    status: 'requested', source: 'request', name: n, email: e,
    company: String(company || '').trim().slice(0, 160), about: String(about || '').trim().slice(0, 600),
  });
  return { created: true, invite };
}

// Staff approve a request: it gets a code and the person is emailed the link.
async function approve(id, emailService, now = new Date()) {
  const invite = await FoundingInvite.findById(id);
  if (!invite || invite.status !== 'requested') { const err = new Error('Already decided.'); err.code = 'closed'; throw err; }
  invite.code = await makeUniqueCode();
  invite.status = 'open';
  invite.decidedAt = now;
  await invite.save();
  if (emailService && invite.email) {
    try { await emailService.sendBillingNoticeEmail(invite.email, (invite.name || '').split(' ')[0], inviteNotice(invite.code)); }
    catch (e) { console.error('Invite email failed:', e.message); }
  }
  return invite;
}

async function decline(id, now = new Date()) {
  const invite = await FoundingInvite.findOneAndUpdate({ _id: id, status: 'requested' }, { $set: { status: 'declined', decidedAt: now } }, { new: true });
  if (!invite) { const err = new Error('Already decided.'); err.code = 'closed'; throw err; }
  return invite;
}

async function revoke(id) {
  const invite = await FoundingInvite.findOneAndUpdate({ _id: id, status: 'open' }, { $set: { status: 'revoked', decidedAt: new Date() } }, { new: true });
  if (!invite) { const err = new Error('That code is not open.'); err.code = 'closed'; throw err; }
  return invite;
}

// Marks an invite used. Idempotent for the same recruiter (checkout return and webhook can both call it).
async function redeem(inviteId, recruiterId, now = new Date()) {
  const done = await FoundingInvite.findOneAndUpdate({ _id: inviteId, status: 'open' }, { $set: { status: 'redeemed', redeemedBy: recruiterId, redeemedAt: now } }, { new: true });
  if (done) return done;
  const again = await FoundingInvite.findOne({ _id: inviteId, redeemedBy: recruiterId });
  return again || null;
}

function inviteNotice(code) {
  return {
    subject: 'Your PreCheckd founding invite',
    headline: 'You are invited to be a founding recruiter',
    paragraphs: [
      'Thanks for asking. We saved you one of the first 100 founding spots: your first year is free. After that it is $349 a year, renewing each year unless you cancel (we email you before it renews), and that price stays locked for as long as you remain a member.',
      'A card is required to start. You will not be charged during the free year as long as you keep up the terms of the deal, which are on the page the link opens. Your invite works once, and your code is ' + code + '.',
    ],
    button: 'Claim my founding year',
    url: joinUrl(code),
  };
}

module.exports = { ALPHABET, CODE_LENGTH, generateCode, cleanCode, createForStaff, findUsable, submitRequest, approve, decline, revoke, redeem, inviteNotice, joinUrl };
