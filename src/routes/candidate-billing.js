// Candidate membership page: choose a plan (card first, then the ID check), see status, manage the card or cancel.
const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const Candidate = require('../models/Candidate');
const billingConfig = require('../config/billing');
const membership = require('../services/membership');
const candidateBilling = require('../services/candidateBilling');
const plans = require('../services/billingPlans');

const base = () => process.env.APP_BASE_URL || 'https://precheckd.com';
const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 });

async function loadCandidate(req, res) {
  if (!req.session.candidateId) { res.redirect('/login'); return null; }
  const c = await Candidate.findById(req.session.candidateId);
  if (!c) { res.redirect('/login'); return null; }
  return c;
}

router.get('/', async (req, res) => {
  try {
    const candidate = await loadCandidate(req, res);
    if (!candidate) return;
    const left = await candidateBilling.foundingSpotsLeft();
    const founding = candidateBilling.alreadyFounding(candidate);
    const feeDue = !founding && left === 0 && !candidateBilling.hadFee(candidate) && !candidate.isIdentityVerified;
    res.render('candidate-billing', {
      pageTitle: 'Membership | PreCheckd',
      enabled: billingConfig.enabled(),
      state: membership.state(candidate), billing: candidate.billing,
      graceDays: membership.graceDaysLeft(candidate),
      needed: req.query.needed === '1', signup: req.query.signup === '1', canceled: req.query.canceled === '1', paid: req.query.paid === '1', error: req.query.error || '',
      founding, spotsLeft: left, feeDue, feeAmount: money(plans.PLANS.candidate_fee.cents),
      monthly: money(plans.PLANS.candidate_monthly.cents), annual: money(plans.PLANS.candidate_annual.cents),
      idVerified: Boolean(candidate.isIdentityVerified),
    });
  } catch (e) {
    console.error('Error loading candidate billing page:', e);
    res.status(500).send('Server error');
  }
});

router.post('/checkout', async (req, res) => {
  try {
    const candidate = await loadCandidate(req, res);
    if (!candidate) return;
    if (!billingConfig.enabled()) return res.redirect('/candidate-billing');
    const out = await candidateBilling.startCheckout({
      stripe, candidate, interval: String(req.body.interval || ''), baseUrl: base(),
      successPath: '/candidate-billing/return', cancelPath: '/candidate-billing?canceled=1',
    });
    res.redirect(303, out.url);
  } catch (e) {
    if (e.code === 'already_active') return res.redirect('/candidate-billing');
    if (e.code === 'bad_interval') return res.redirect('/candidate-billing?error=interval');
    console.error('Error starting candidate checkout:', e);
    res.redirect('/candidate-billing?error=checkout');
  }
});

router.get('/return', async (req, res) => {
  try {
    const candidate = await loadCandidate(req, res);
    if (!candidate) return;
    const sid = String(req.query.session_id || '');
    if (sid) await candidateBilling.confirmReturn({ stripe, candidate, sessionId: sid });
    // New members still owe the ID check; send them straight to it.
    if (!candidate.isIdentityVerified && membership.isMember(candidate)) return res.redirect('/candidate-signup?verify=identity');
    res.redirect('/candidate-billing?paid=1');
  } catch (e) {
    console.error('Error confirming candidate payment:', e.message);
    res.redirect('/candidate-billing?paid=1');
  }
});

router.post('/portal', async (req, res) => {
  try {
    const candidate = await loadCandidate(req, res);
    if (!candidate) return;
    const url = await candidateBilling.portalUrl({ stripe, candidate, returnUrl: `${base()}/candidate-billing` });
    res.redirect(303, url);
  } catch (e) {
    console.error('Error opening candidate billing portal:', e.message);
    res.redirect('/candidate-billing?error=portal');
  }
});

module.exports = router;
