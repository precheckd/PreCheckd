// Runs the certification-expiry reminders on a timer inside the web process.
// Checks hourly; the run itself decides who is due and only sends during
// daytime hours (see services/certExpiryReminders.js), so running it often is
// harmless.
//
// Like the message digest, this only fires while the server is running. On a
// host that sleeps idle services, run `npm run cert-reminders` from a
// scheduled/cron job instead (same code path). DISABLE_JOBS=true turns the
// in-process timer off.
const { runCertExpiryReminders } = require('../services/certExpiryReminders');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;

function startCertExpiryJob() {
  if (process.env.DISABLE_JOBS === 'true') {
    console.log('[jobs] DISABLE_JOBS=true — cert expiry timer not started');
    return null;
  }

  const tick = () => {
    runCertExpiryReminders()
      .then((result) => {
        if (result.sent > 0) console.log(`[jobs] cert expiry reminders: sent ${result.sent}`);
      })
      .catch((err) => console.error('[jobs] cert expiry reminders failed:', err));
  };

  // Also check shortly after boot: a restart or wake-up resets the hourly
  // clock, so on a host that restarts/sleeps the first hourly tick may never
  // come. Safe to repeat; reminders are claimed before sending.
  setTimeout(tick, STARTUP_DELAY_MS).unref();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startCertExpiryJob };
