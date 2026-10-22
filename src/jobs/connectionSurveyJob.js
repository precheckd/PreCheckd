// Hourly: sends the 30-day recruiter survey bell to candidates whose connection has reached 30 days.
const { sendDueSurveys } = require('../services/connectionEnd');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 150 * 1000;

function startConnectionSurveyJob() {
  if (process.env.DISABLE_JOBS === 'true') return null;
  const tick = async () => {
    try { const r = await sendDueSurveys(); if (r.sent) console.log(`[jobs] connection surveys sent=${r.sent}`); }
    catch (err) { console.error('[jobs] connection surveys failed:', err); }
  };
  setTimeout(tick, STARTUP_DELAY_MS).unref();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startConnectionSurveyJob };
