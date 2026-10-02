const express = require('express');
const router = express.Router();
const { checkDomainAge } = require('../utils/domainAgeCheck');
const Recruiter = require('../models/Recruiter');
const FraudReport = require('../models/FraudReport');
const { sendLookupNudgeEmail } = require('../services/emailService');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).json({ error: 'You must be logged in as a candidate to use this tool.' });
  }
  next();
}

router.use(requireCandidateLogin);

// "We've contacted this account" window — same spirit as the fraud-report
// email debounce: recent and relevant, not a permanent scarlet letter.
const CONTACT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// At most one "someone looked you up" nudge per unverified account per
// week, however many lookups happen in that window.
const LOOKUP_NUDGE_DEBOUNCE_MS = 7 * 24 * 60 * 60 * 1000;

// Fire-and-forget: a candidate who's just using the checker should never
// wait on, or be affected by, whether this nudge email succeeds.
async function maybeSendLookupNudge(account) {
  try {
    if (account.accountTier !== 'unverified_claim') return; // only nudging accounts with nothing to show yet

    const recentlyNudged = account.lastLookupNudgeAt
      && (Date.now() - account.lastLookupNudgeAt.getTime()) < LOOKUP_NUDGE_DEBOUNCE_MS;
    if (recentlyNudged) return;

    account.lastLookupNudgeAt = new Date();
    await account.save();

    await sendLookupNudgeEmail(account.email);
  } catch (error) {
    console.error('Failed to send lookup nudge email:', error);
  }
}

// POST /api/email-checker/check — runs a WHOIS domain-age check on a submitted email
router.post('/check', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const domain = normalizedEmail.split('@')[1];

    let domainCheck = null;
    let domainCheckError = null;

    try {
      domainCheck = await checkDomainAge(domain);
    } catch (error) {
      console.error('Domain age check failed:', error);
      domainCheckError = 'Could not check domain registration info right now.';
    }

    // Exact-email match only — this is "have we contacted this specific
    // address," not a domain-wide signal, so it stays narrow on purpose.
    let contactCount = 0;
    const account = await Recruiter.findOne({ email: normalizedEmail });
    if (account) {
      const since = new Date(Date.now() - CONTACT_WINDOW_MS);
      contactCount = await FraudReport.countDocuments({
        matchedRecruiterId: account._id,
        recruiterNotified: true,
        status: { $ne: 'dismissed' },
        createdAt: { $gte: since },
      });

      // Doesn't block or slow down the response the candidate is waiting on.
      maybeSendLookupNudge(account).catch((error) => {
        console.error('Unhandled error sending lookup nudge email:', error);
      });
    }

    res.json({ email: normalizedEmail, domain, domainCheck, domainCheckError, contactCount });
  } catch (error) {
    console.error('Error running email check:', error);
    res.status(500).json({ error: 'Something went wrong running this check. Please try again.' });
  }
});

module.exports = router;
