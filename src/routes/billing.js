// Recruiter billing page: pick a plan, see status, manage the card or cancel in Stripe's portal.
const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const Recruiter = require('../models/Recruiter');
const billingConfig = require('../config/billing');
const membership = require('../services/membership');
const recruiterBilling = require('../services/recruiterBilling');
const plans = require('../services/billingPlans');

const base = () => process.env.BASE_URL || '';

async function loadRecruiter(req, res) {
  if (!req.session.recruiterId) { res.redirect('/login'); return null; }
  const r = await Recruiter.findById(req.session.recruiterId);
  if (!r) { res.redirect('/login'); return null; }
  return r;
}

const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 });

router.get('/', async (req, res) => {
  try {
    const recruiter = await loadRecruiter(req, res);
    if (!recruiter) return;
    const st = await recruiterBilling.status();
    const state = membership.state(recruiter);
    res.render('billing', {
      pageTitle: 'Membership | PreCheckd',
      enabled: billingConfig.enabled(),
      state, billing: recruiter.billing,
      graceDays: membership.graceDaysLeft(recruiter),
      needed: req.query.needed === '1', canceled: req.query.canceled === '1', paid: req.query.paid === '1', error: req.query.error || '',
      wave: st, hadFounding: recruiterBilling.hadFounding(recruiter),
      monthly: money(plans.PLANS.recruiter_monthly.cents), annual: money(plans.PLANS.recruiter_annual.cents), foundingPrice: money(st.priceCents),
      limit: membership.openLimit(recruiter),
    });
  } catch (e) {
    console.error('Error loading billing page:', e);
    res.status(500).send('Server error');
  }
});

// POST /billing/checkout  interval=monthly|annual
router.post('/checkout', async (req, res) => {
  try {
    const recruiter = await loadRecruiter(req, res);
    if (!recruiter) return;
    if (!billingConfig.enabled()) return res.redirect('/billing');
    const out = await recruiterBilling.startCheckout({
      stripe, recruiter, interval: String(req.body.interval || ''), baseUrl: base(),
      successPath: '/billing/return', cancelPath: '/billing?canceled=1',
    });
    res.redirect(303, out.url);
  } catch (e) {
    if (e.code === 'already_active') return res.redirect('/billing');
    if (e.code === 'bad_interval') return res.redirect('/billing?error=interval');
    console.error('Error starting checkout:', e);
    res.redirect('/billing?error=checkout');
  }
});

// GET /billing/return?session_id=... — back from Stripe Checkout
router.get('/return', async (req, res) => {
  try {
    const recruiter = await loadRecruiter(req, res);
    if (!recruiter) return;
    const sid = String(req.query.session_id || '');
    if (sid) await recruiterBilling.confirmReturn({ stripe, recruiter, sessionId: sid });
    // Brand-new recruiters still owe the ID check; send them back to it.
    if (!recruiter.isIdentityVerified && membership.isMember(recruiter)) return res.redirect('/founding-recruiter?step=identity');
    res.redirect('/billing?paid=1');
  } catch (e) {
    console.error('Error confirming payment:', e.message);
    res.redirect('/billing?paid=1');
  }
});

// POST /billing/portal — Stripe's page for the card, invoices and cancelling
router.post('/portal', async (req, res) => {
  try {
    const recruiter = await loadRecruiter(req, res);
    if (!recruiter) return;
    const url = await recruiterBilling.portalUrl({ stripe, recruiter, returnUrl: `${base()}/billing` });
    res.redirect(303, url);
  } catch (e) {
    console.error('Error opening billing portal:', e.message);
    res.redirect('/billing?error=portal');
  }
});

module.exports = router;
