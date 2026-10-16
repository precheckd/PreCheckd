const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const MailAlias = require('../models/MailAlias');
const OutreachMessage = require('../models/OutreachMessage');
const { sendOutreach, applyChoice, quotaFor, isFullyVerified, enabled, TEMPLATES, MAX_NOTE_CHARS } = require('../services/outreach');
const { ensureMailAlias, addressFor } = require('../utils/mailAlias');
const { readOutreachToken } = require('../utils/outreachToken');

// Verified recruiter outreach (roadmap #4). Two halves:
//   /outreach/choice/:token  PUBLIC  the recipient's page (Not interested /
//                            Stop all / Report as scam). GET changes nothing,
//                            so mail scanners that open links can't opt anyone
//                            out; the buttons POST.
//   /outreach                recruiters only: send an outreach email, see what
//                            was sent.

const CHOICE_DONE = {
  not_interested: 'Done. This recruiter will not email you again.',
  stop_all: 'Done. We will not pass any more recruiter email to this address.',
  scam_report: 'Reported. This recruiter is blocked from emailing you again, and PreCheckd staff will review it. Thank you.'
};

async function renderChoice(res, token, state, extra = {}) {
  return res.status(state === 'invalid' ? 400 : 200).render('outreach-choice', { pageTitle: 'Recruiter email | PreCheckd', state, who: null, message: null, ...extra });
}

router.get('/choice/:token', async (req, res) => {
  try {
    const id = readOutreachToken(req.params.token);
    if (!id) return renderChoice(res, null, 'invalid');
    const msg = await OutreachMessage.findById(id);
    if (!msg) return renderChoice(res, null, 'invalid');
    const rec = await Recruiter.findById(msg.recruiterId);
    const who = rec ? [rec.firstName, rec.lastName].filter(Boolean).join(' ') : 'A recruiter';
    return renderChoice(res, null, 'choose', { who });
  } catch (error) {
    console.error('Error loading outreach choice:', error);
    return res.status(500).send('Server error');
  }
});

router.post('/choice/:token', async (req, res) => {
  try {
    const id = readOutreachToken(req.params.token);
    if (!id) return renderChoice(res, null, 'invalid');
    // A mail app's one-click "unsubscribe" posts no choice: treat it as stopping everything.
    const choice = ['not_interested', 'stop_all', 'scam_report'].includes(req.body && req.body.choice)
      ? req.body.choice
      : 'stop_all';
    const ok = await applyChoice(id, choice);
    if (!ok) return renderChoice(res, null, 'invalid');
    return renderChoice(res, null, 'done', { message: CHOICE_DONE[choice] });
  } catch (error) {
    console.error('Error saving outreach choice:', error);
    return res.status(500).send('Server error');
  }
});

// --- Recruiter side ---------------------------------------------------------

function requireRecruiter(req, res, next) {
  if (!req.session.recruiterId) return res.redirect('/login');
  next();
}
router.use(requireRecruiter);

const ERRORS = {
  disabled: 'Outreach is not switched on yet.',
  not_configured: 'Outreach is not fully set up yet. Please check back soon.',
  not_verified: 'Only fully verified recruiters can send outreach.',
  template: 'Pick one of the templates.',
  bad_email: 'Enter a valid email address for the person you want to reach.',
  role: 'Enter the role (words only, no links).',
  note_long: `Keep your note under ${MAX_NOTE_CHARS} characters.`,
  note_links: 'Your note can include at most two links. Links are shown as plain text, not clickable.',
  unsafe: 'Messages cannot include Social Security, card or bank account numbers. Take those out and try again.',
  paused: 'Your outreach is paused while PreCheckd staff review reports from recipients. Please contact support.',
  blocked: 'We cannot email this address. The person may have asked not to be contacted.',
  duplicate: 'You already emailed this address in the last 30 days.',
  daily_cap: "You've reached today's outreach limit. Try again tomorrow.",
  monthly_cap: "You've reached this month's outreach limit.",
  send_failed: 'The email could not be sent. Please try again in a few minutes.'
};

const STATUS_NOTE = { not_interested: 'Not interested', stop_all: 'Asked not to be emailed', scam_report: 'Reported' };

async function renderPage(req, res, { error = null, sent = false, form = {}, statusCode = 200 } = {}) {
  const recruiter = await Recruiter.findById(req.session.recruiterId);
  if (!recruiter) return res.redirect('/login');
  const verified = isFullyVerified(recruiter);
  const [quota, recent] = await Promise.all([
    quotaFor(recruiter._id),
    OutreachMessage.find({ recruiterId: recruiter._id, status: 'sent' }).sort({ sentAt: -1 }).limit(30)
  ]);
  return res.status(statusCode).render('outreach', {
    pageTitle: 'Outreach | PreCheckd',
    enabled: enabled(),
    verified,
    quota,
    error,
    sent,
    form,
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, needsRole: t.needsRole })),
    maxNote: MAX_NOTE_CHARS,
    recent: recent.map((m) => ({
      to: m.toEmail, subject: m.subject, at: m.sentAt,
      note: m.recipientAction ? STATUS_NOTE[m.recipientAction] : ''
    }))
  });
}

router.get('/', async (req, res) => {
  try {
    return await renderPage(req, res, { sent: req.query.sent === '1' });
  } catch (error) {
    console.error('Error loading outreach page:', error);
    return res.status(500).send('Server error');
  }
});

router.post('/send', async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.session.recruiterId);
    if (!recruiter) return res.redirect('/login');
    const body = req.body || {};
    const form = {
      toEmail: String(body.toEmail || '').slice(0, 254), toName: String(body.toName || '').slice(0, 40),
      templateKey: String(body.templateKey || ''), role: String(body.role || '').slice(0, 80), note: String(body.note || '').slice(0, 5000)
    };
    let alias = null;
    try { alias = await ensureMailAlias('recruiter', recruiter); } catch (e) { alias = null; }
    const result = await sendOutreach({ recruiter, alias, input: form });
    if (result.error) {
      return await renderPage(req, res, { error: result.message || ERRORS[result.error] || 'Something went wrong.', form, statusCode: 400 });
    }
    return res.redirect('/outreach?sent=1');
  } catch (error) {
    console.error('Error sending outreach:', error);
    return res.status(500).send('Server error');
  }
});

module.exports = router;
