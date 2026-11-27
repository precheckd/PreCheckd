// The one-time page a manager, HR contact or coworker opens from the verification email to confirm a job's title and
// dates. No login. Shows the person's name, title, employer and dates (the email already says them) and nothing else.
// An answer never verifies the job by itself: staff read it on the case.
const express = require('express');
const router = express.Router();
const { answerManager } = require('../services/verificationCases');

const page = (res, state, info = {}, token = '', error = '') => res.render('job-confirm', { pageTitle: 'Confirm a job | PreCheckd', robotsMeta: 'noindex', state, info, token, error });

router.get('/:token', async (req, res) => {
  try {
    const r = await answerManager(req.params.token);
    if (!r.found) return page(res.status(404), 'invalid');
    if (r.closed) return page(res, 'closed', r.info);
    if (r.already) return page(res, 'done', r.info);
    page(res, 'ask', r.info, req.params.token);
  } catch (error) {
    console.error('Error loading job confirmation:', error);
    res.status(500).send('Server error');
  }
});

router.post('/:token', async (req, res) => {
  try {
    const r = await answerManager(req.params.token, req.body || {});
    if (!r.found) return page(res.status(404), 'invalid');
    if (r.closed) return page(res, 'closed', r.info);
    if (r.needsAnswer) return page(res.status(r.error ? 400 : 200), 'ask', r.info, req.params.token, r.error || 'Please pick one of the three answers.');
    page(res, 'done', r.info);
  } catch (error) {
    console.error('Error saving job confirmation:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
