const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const OutreachMessage = require('../models/OutreachMessage');
const { applyChoice } = require('../services/outreach');
const MailMessage = require('../models/MailMessage');
const Candidate = require('../models/Candidate');
const candidateCompose = require('../services/candidateCompose');
const { readOutreachToken, readMailToken } = require('../utils/outreachToken');

// Verified recruiter outreach (roadmap #4). Two halves:
//   /outreach/choice/:token  PUBLIC  the recipient's page (Not interested /
//                            Stop all / Report as scam). GET changes nothing,
//                            so mail scanners that open links can't opt anyone
//                            out; the buttons POST.
// Recruiters write and review these in Mail (/mail/new and /mail/sent).

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

// The same page for an email a verified member (candidate) wrote themselves.
const MEMBER_DONE = {
  not_interested: 'Done. This member will not email you again.',
  stop_all: 'Done. We will not pass any more member email to this address.',
  scam_report: 'Reported. This member is blocked from emailing you again, and PreCheckd staff will review it. Thank you.'
};

router.get('/m/:token', async (req, res) => {
  try {
    const id = readMailToken(req.params.token);
    const msg = id ? await MailMessage.findById(id) : null;
    if (!msg || !msg.composed) return renderChoice(res, null, 'invalid');
    const cand = await Candidate.findById(msg.ownerId);
    const who = cand ? [cand.firstName, cand.lastName].filter(Boolean).join(' ') : 'A member';
    return renderChoice(res, null, 'choose', { who, kind: 'member' });
  } catch (error) {
    console.error('Error loading member choice:', error);
    return res.status(500).send('Server error');
  }
});

router.post('/m/:token', async (req, res) => {
  try {
    const id = readMailToken(req.params.token);
    if (!id) return renderChoice(res, null, 'invalid');
    const choice = ['not_interested', 'stop_all', 'scam_report'].includes(req.body && req.body.choice) ? req.body.choice : 'stop_all';
    const ok = await candidateCompose.applyChoice(id, choice);
    if (!ok) return renderChoice(res, null, 'invalid');
    return renderChoice(res, null, 'done', { message: MEMBER_DONE[choice], kind: 'member' });
  } catch (error) {
    console.error('Error saving member choice:', error);
    return res.status(500).send('Server error');
  }
});

// The recruiter side now lives in Mail (/mail/new and /mail/sent); the old address still works.
router.get('/', (req, res) => res.redirect('/mail/new'));

module.exports = router;
