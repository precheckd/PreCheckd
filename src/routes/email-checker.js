const express = require('express');
const router = express.Router();
const { checkDomainAge } = require('../utils/domainAgeCheck');
const { checkEmailBreaches } = require('../utils/breachCheck');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).json({ error: 'You must be logged in as a candidate to use this tool.' });
  }
  next();
}

router.use(requireCandidateLogin);

// POST /api/email-checker/check — runs WHOIS + breach checks on a submitted email
router.post('/check', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const domain = email.split('@')[1];

    const [domainResult, breachResult] = await Promise.allSettled([
      checkDomainAge(domain),
      checkEmailBreaches(email),
    ]);

    const response = {
      email,
      domain,
      domainCheck: null,
      domainCheckError: null,
      breachCheck: null,
      breachCheckError: null,
    };

    if (domainResult.status === 'fulfilled') {
      response.domainCheck = domainResult.value;
    } else {
      console.error('Domain age check failed:', domainResult.reason);
      response.domainCheckError = 'Could not check domain registration info right now.';
    }

    if (breachResult.status === 'fulfilled') {
      response.breachCheck = breachResult.value;
    } else {
      console.error('Breach check failed:', breachResult.reason);
      response.breachCheckError = 'Could not check breach history right now.';
    }

    res.json(response);
  } catch (error) {
    console.error('Error running email check:', error);
    res.status(500).json({ error: 'Something went wrong running this check. Please try again.' });
  }
});

module.exports = router;