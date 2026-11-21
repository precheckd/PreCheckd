// Demo mode guard (see config/demo.js). Mounted right after the session, before anything else.
const demo = require('../config/demo');

// The only POSTs the demo accepts: signing in as a demo account, the two access requests (which the demo approves
// on the spot, see services/demoApprovals.js), and the posting form's skill suggestions (saves nothing; capped per day).
const ALLOWED = [
  /^\/demo\/(recruiter|candidate)$/,
  /^\/candidate-search\/[^/]+\/connect$/,
  /^\/recruiter-dashboard\/requests\/[a-f0-9]{24}\/request-full-access$/,
  /^\/recruiter-jobs\/suggest$/,
];

const MESSAGE = 'This is a demo with sample data, so that action is turned off here. Start your founding spot to use it for real.';

function demoMode() {
  return (req, res, next) => {
    if (!demo.enabled()) return next();
    // Staff pages and payment/email webhooks do not exist in the demo.
    if (req.hostname === (process.env.ADMIN_HOSTNAME || 'admin.precheckd.com') || req.path.startsWith('/webhooks')) return res.status(404).send('Not found');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.locals.demoMode = true;
    res.locals.demoSignupUrl = demo.signupUrl();
    res.locals.robotsMeta = 'noindex, nofollow';
    if (req.path === '/robots.txt') return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (ALLOWED.some((re) => re.test(req.path))) return next();
    const wantsJson = req.path.startsWith('/api/') || req.xhr || /json/.test(req.get('accept') || '');
    if (wantsJson) return res.status(403).json({ error: MESSAGE, demo: true });
    return res.status(403).render('demo-blocked', { pageTitle: 'Demo | PreCheckd', message: MESSAGE, signupUrl: demo.signupUrl() });
  };
}

module.exports = { demoMode, ALLOWED, MESSAGE };
