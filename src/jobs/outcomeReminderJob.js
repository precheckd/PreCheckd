// Hourly check for outcome reminders and for postings past their close date (the service acts only in the morning window for emails).
const { runOutcomeReminders } = require('../services/outcomeReminders');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 120 * 1000;

function startOutcomeReminderJob() {
  if (process.env.DISABLE_JOBS === 'true') return null;
  const tick = async () => {
    try {
      const r = await runOutcomeReminders();
      console.log(`[jobs] outcome reminder check: sent=${r.sent || 0}`);
    } catch (err) { console.error('[jobs] outcome reminder failed:', err); }
  };
  setTimeout(tick, STARTUP_DELAY_MS).unref();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startOutcomeReminderJob };
