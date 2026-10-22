// The person a recruiter named as hired (outside PreCheckd) confirms or denies it from the emailed link. This page
// never shows their name or the recruiter's, and needs no login.
const express = require('express');
const router = express.Router();
const { answerHireConfirmation } = require('../services/postingOutcome');

const page = (res, state, info = {}, token = '') => res.render('hire-confirm', { pageTitle: 'Confirm your new job | PreCheckd', robotsMeta: 'noindex', state, info, token });

router.get('/:token', async (req, res) => {
  try {
    const r = await answerHireConfirmation(req.params.token, null);
    if (!r.found) return page(res.status(404), 'invalid');
    if (r.already) return page(res, 'done', r);
    if (r.status === 'expired') return page(res, 'expired', r);
    page(res, 'ask', r, req.params.token);
  } catch (error) {
    console.error('Error loading hire confirmation:', error);
    res.status(500).send('Server error');
  }
});

router.post('/:token', async (req, res) => {
  try {
    const r = await answerHireConfirmation(req.params.token, String(req.body.answer || ''));
    if (!r.found) return page(res.status(404), 'invalid');
    if (r.needsAnswer) return page(res, 'ask', r, req.params.token);
    page(res, r.status === 'expired' ? 'expired' : 'done', r);
  } catch (error) {
    console.error('Error saving hire confirmation:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
