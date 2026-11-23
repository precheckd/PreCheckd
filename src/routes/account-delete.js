// Delete my account (candidates and recruiters). Password plus the word DELETE are required, so a stray click or a
// borrowed session can't do it. Everything is removed; see services/accountDeletion.js.
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const stripe = require('../config/stripe');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const deletion = require('../services/accountDeletion');
const s3 = require('../utils/s3Upload');
const emailService = require('../services/emailService');

function who(req) {
  if (req.session.recruiterId) return { kind: 'recruiter', Model: Recruiter, id: req.session.recruiterId };
  if (req.session.candidateId) return { kind: 'candidate', Model: Candidate, id: req.session.candidateId };
  return null;
}

router.get('/delete', (req, res) => {
  const w = who(req);
  if (!w) return res.redirect('/login');
  res.render('account-delete', { pageTitle: 'Delete my account | PreCheckd', kind: w.kind, error: null });
});

router.post('/delete', async (req, res) => {
  try {
    const w = who(req);
    if (!w) return res.redirect('/login');
    const render = (error) => res.status(400).render('account-delete', { pageTitle: 'Delete my account | PreCheckd', kind: w.kind, error });
    if (String(req.body.confirm || '').trim() !== 'DELETE') return render('Type DELETE in capital letters to confirm.');
    const doc = await w.Model.findById(w.id);
    if (!doc) return res.redirect('/login');
    if (!doc.passwordHash || !(await bcrypt.compare(String(req.body.password || ''), doc.passwordHash))) return render('That password is not right.');
    try { await deletion.deleteAccount(w.kind, doc, { stripe, s3 }); }
    catch (e) { console.error('Account deletion failed:', e.message); return res.status(500).render('account-delete', { pageTitle: 'Delete my account | PreCheckd', kind: w.kind, error: 'We could not finish deleting your account, and nothing was removed. Please try again, or email us.' }); }
    // The confirmation goes to the address they had; it is used once and not stored anywhere.
    try { if (doc.email) await emailService.sendAccountDeletedEmail(doc.email, doc.firstName); } catch (e) { console.error('Deletion confirmation email failed:', e.message); }
    req.session.destroy(() => res.redirect('/account/deleted'));
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).send('Server error');
  }
});

router.get('/deleted', (req, res) => {
  res.render('account-deleted', { pageTitle: 'Account deleted | PreCheckd' });
});

module.exports = router;
