// Hourly check for skill-test reminders (retake open, result needs retake, link expiring). Runs in
// the web process like the other jobs; each notice is claimed with a one-shot flag, so running it
// often or after a restart is harmless. DISABLE_JOBS=true turns the timer off.
const { runSkillReminders, openRequestsDigest } = require('../services/skillNotifications');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 2 * 60 * 1000;

// The open-requests digest goes out once a day, in the 8 o'clock hour New York time.
const ET_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
let lastDigestDay = null;
function maybeSendDigest() {
  const now = new Date();
  if (Number(ET_HOUR.format(now)) % 24 !== 8) return;
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (lastDigestDay === day) return;
  lastDigestDay = day;
  openRequestsDigest()
    .then((n) => console.log(`[jobs] skill request digest: ${n} skills waiting`))
    .catch((err) => console.error('[jobs] skill request digest failed:', err));
  require('../services/verificationCases').sendDigest()
    .then((n) => console.log(`[jobs] verification digest: ${n} items`))
    .catch((err) => console.error('[jobs] verification digest failed:', err));
}

function startSkillRemindersJob() {
  if (process.env.DISABLE_JOBS === 'true') {
    console.log('[jobs] DISABLE_JOBS=true, skill reminders timer not started');
    return null;
  }
  const tick = () => {
    maybeSendDigest();
    require('../services/verificationCases').purgeOldFiles().catch((err) => console.error('[jobs] verification file purge failed:', err));
    require('../services/verificationCases').runDue()
      .then((c) => console.log(`[jobs] verification cases: emailed=${c.emails} opened=${c.opened}`))
      .catch((err) => console.error('[jobs] verification cases failed:', err));
    require('../services/testRequests').expireOverdue().catch((err) => console.error('[jobs] test request expiry failed:', err));
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
