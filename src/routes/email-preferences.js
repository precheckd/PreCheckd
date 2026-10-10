const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const { readUnsubscribeToken } = require('../utils/emailUnsubscribe');

// Unsubscribe from the weekly candidate emails. The emailed link opens a
// confirm page (GET changes nothing, so mail scanners that pre-fetch links
// can't unsubscribe anyone by accident); the button POSTs. The same POST also
// answers the one-click List-Unsubscribe header that mail apps send.

function render(res, state) {
  res.render('email-unsubscribe', { pageTitle: 'Weekly emails | PreCheckd', state });
}

router.get('/unsubscribe/:token', async (req, res) => {
  const id = readUnsubscribeToken(req.params.token);
  if (!id) return res.status(400).render('email-unsubscribe', { pageTitle: 'Weekly emails | PreCheckd', state: 'invalid' });
  render(res, 'confirm');
});

router.post('/unsubscribe/:token', async (req, res) => {
  try {
    const id = readUnsubscribeToken(req.params.token);
    if (!id) return res.status(400).render('email-unsubscribe', { pageTitle: 'Weekly emails | PreCheckd', state: 'invalid' });
    await Candidate.updateOne({ _id: id }, { weeklyEmailOptOut: true });
    render(res, 'done');
  } catch (error) {
    console.error('Error unsubscribing from weekly emails:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
