// Hourly check for skill-test reminders (retake open, result needs retake, link expiring). Runs in
// the web process like the other jobs; each notice is claimed with a one-shot flag, so running it
// often or after a restart is harmless. DISABLE_JOBS=true turns the timer off.
const { runSkillReminders } = require('../services/skillNotifications');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 2 * 60 * 1000;

function startSkillRemindersJob() {
  if (process.env.DISABLE_JOBS === 'true') {
    console.log('[jobs] DISABLE_JOBS=true, skill reminders timer not started');
    return null;
  }
  const tick = () => {
    runSkillReminders()
      .then((c) => console.log(`[jobs] skill reminders: retake=${c.retake} stale=${c.stale} expiring=${c.expiring}`))
      .catch((err) => console.error('[jobs] skill reminders failed:', err));
  };
  setTimeout(tick, STARTUP_DELAY_MS).unref();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startSkillRemindersJob };
