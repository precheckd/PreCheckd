// Runs the recruiters' daily applicant email on a timer inside the web process (checks hourly; the service only acts
// on weekday mornings and claims atomically, so repeats are harmless). DISABLE_JOBS=true turns the timer off.
const { runApplicantDigest } = require('../services/applicantDigest');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 120 * 1000;

function startApplicantDigestJob() {
  if (process.env.DISABLE_JOBS === 'true') return null;
  const tick = async () => {
    try {
      const r = await runApplicantDigest();
      console.log(`[jobs] applicant digest check: sent=${r.sent || 0}`);
    } catch (err) { console.error('[jobs] applicant digest failed:', err); }
  };
  setTimeout(tick, STARTUP_DELAY_MS).unref();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startApplicantDigestJob };
