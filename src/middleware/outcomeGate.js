// The outcome gate: a recruiter who owes an outcome for a posting whose close date has passed sees nothing but the
// outcome form (not dismissable, everything frozen). Exempt: log out, Terms, Privacy, billing, the outcome form
// itself, hire confirmations, static files and webhooks.
const { closeExpired, awaitingPostingFor } = require('../services/postingOutcome');

const EXEMPT = [
  /^\/logout$/, /^\/terms(\/|$)/, /^\/privacy(\/|$)/, /^\/billing(\/|$)/, /^\/hire-confirm\//, /^\/webhooks\//, /^\/email\/unsubscribe\//,
  /^\/css\//, /^\/js\//, /^\/img\//, /^\/favicon/, /^\/robots\.txt$/,
  /^\/recruiter-jobs\/[a-f0-9]{24}\/outcome$/,
];
const isExempt = (path) => EXEMPT.some((re) => re.test(path));

function outcomeGate({ adminHost } = {}) {
  return async function gate(req, res, next) {
    try {
      if (!req.session || !req.session.recruiterId) return next();
      if (adminHost && req.hostname === adminHost) return next();
      if (isExempt(req.path)) return next();
      await closeExpired({ recruiterId: req.session.recruiterId });
      const owed = await awaitingPostingFor(req.session.recruiterId);
      if (!owed) return next();
      const target = `/recruiter-jobs/${owed._id}/outcome`;
      const wantsJson = req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json');
      if (wantsJson) return res.status(423).json({ error: 'Record the outcome of your closed job first.', redirect: target });
      return res.redirect(target);
    } catch (err) {
      console.error('Outcome gate error:', err);
      return next(); // never lock people out because the check itself failed
    }
  };
}

module.exports = { outcomeGate, isExempt };
