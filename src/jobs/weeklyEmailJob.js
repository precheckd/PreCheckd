// Runs the weekly candidate emails on a timer inside the web process. Checks
// hourly; each run only acts during its own window (Monday or Thursday,
// 7:00-10:59 ET) and the claim logic prevents repeats, so running it often is
// harmless. Only fires while the server is running: on a host that sleeps idle
// services, run `npm run weekly-emails` from a scheduled job (every hour) instead.
// DISABLE_JOBS=true turns the in-process timer off.
const { runWeeklyRecap, runUnreadMessagesEmail } = require('../services/weeklyEmails');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;

function startWeeklyEmailJob() {
  if (process.env.DISABLE_JOBS === 'true') {
    console.log('[jobs] DISABLE_JOBS=true — weekly email timer not started');
    return null;
  }

  const tick = async () => {
    try {
      const recap = await runWeeklyRecap();
      const unread = await runUnreadMessagesEmail();
      console.log(`[jobs] weekly emails check: recap sent=${recap.sent || 0}, unread email sent=${unread.sent || 0}`);
    } catch (err) {
      console.error('[jobs] weekly emails failed:', err);
    }
  };

  // Also check shortly after boot (a restart or wake-up resets the hourly
  // clock). Safe to repeat; the claim logic prevents duplicates.
  setTimeout(tick, STARTUP_DELAY_MS).unref();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startWeeklyEmailJob };
