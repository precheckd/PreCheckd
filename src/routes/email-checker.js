const express = require('express');
const router = express.Router();
const { checkDomainAge } = require('../utils/domainAgeCheck');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).json({ error: 'You must be logged in as a candidate to use this tool.' });
  }
  next();
}

router.use(requireCandidateLogin);

// POST /api/email-checker/check — runs a WHOIS domain-age check on a submitted email
router.post('/check', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const domain = email.split('@')[1];

    let domainCheck = null;
    let domainCheckError = null;

    try {
      domainCheck = await checkDomainAge(domain);
    } catch (error) {
      console.error('Domain age check failed:', error);
      domainCheckError = 'Could not check domain registration info right now.';
    }

    res.json({ email, domain, domainCheck, domainCheckError });
  } catch (error) {
    console.error('Error running email check:', error);
    res.status(500).json({ error: 'Something went wrong running this check. Please try again.' });
  }
});

module.exports = router;