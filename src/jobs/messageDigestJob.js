// Runs the unread-messages digest on a timer inside the web process. It
// checks every 30 minutes; the digest itself decides who's due (see
// services/messageDigest.js), so running it often is harmless.
//
// This only fires while the server is running — on a host that sleeps idle
// services, run `npm run digest` from a scheduled/cron job instead (same
// code path). Set DISABLE_JOBS=true to turn the in-process timer off.
const { runMessageDigest } = require('../services/messageDigest');

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function startMessageDigestJob() {
  if (process.env.DISABLE_JOBS === 'true') {
    console.log('[jobs] DISABLE_JOBS=true — message digest timer not started');
    return null;
  }

  const tick = () => {
    runMessageDigest()
      .then((result) => {
        if (result.sent > 0) console.log(`[jobs] message digest: sent ${result.sent}`);
      })
      .catch((err) => console.error('[jobs] message digest failed:', err));
  };

  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startMessageDigestJob };
