// Time a skill request has been waiting, counting only weekday hours (Mon-Fri, New York time),
// because the promise to candidates is "within 1 business day".
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
const HOUR_MS = 3600000;
const DUE_SOON_HOURS = 20;
const OVERDUE_HOURS = 24;

function businessHoursSince(from, now = Date.now()) {
  let t = new Date(from).getTime();
  let hours = 0;
  while (t < now) {
    const step = Math.min(HOUR_MS, now - t);
    const day = WEEKDAY.format(new Date(t));
    if (day !== 'Sat' && day !== 'Sun') hours += step / HOUR_MS;
    t += step;
  }
  return hours;
}

// 'overdue' at 24 business hours, 'soon' from 20.
function slaFlag(hours) {
  return hours >= OVERDUE_HOURS ? 'overdue' : hours >= DUE_SOON_HOURS ? 'soon' : 'ok';
}

module.exports = { businessHoursSince, slaFlag, DUE_SOON_HOURS, OVERDUE_HOURS };
