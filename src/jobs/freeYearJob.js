// Hourly check of the free founding year (see services/freeYear.js). Idempotent, so running often is safe.
const { runFreeYearCheck } = require('../services/freeYear');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 150 * 1000;

function startFreeYearJob() {
  if (process.env.DISABLE_JOBS === 'true') return null;
  const tick = async () => {
    try {
      const r = await runFreeYearCheck({ stripe: require('../config/stripe') });
      console.log(`[jobs] free year check: checked=${r.checked} warned=${r.warned} ended=${r.ended}`);
    } catch (err) { console.error('[jobs] free year check failed:', err); }
  };
  setTimeout(tick, STARTUP_DELAY_MS).unref();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startFreeYearJob };
