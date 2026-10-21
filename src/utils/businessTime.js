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

// Whole weekdays (New York time) after the day `from` falls on, up to and including today. A case started on a
// Tuesday is on day 1 on Wednesday and day 4 the following Monday.
const NY_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
function businessDaysSince(from, now = Date.now()) {
  const start = new Date(`${NY_DAY.format(new Date(from))}T12:00:00Z`).getTime();
  const end = new Date(`${NY_DAY.format(new Date(now))}T12:00:00Z`).getTime();
  let n = 0;
  for (let t = start + 86400000; t <= end; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}

// 'overdue' at 24 business hours, 'soon' from 20.
function slaFlag(hours) {
  return hours >= OVERDUE_HOURS ? 'overdue' : hours >= DUE_SOON_HOURS ? 'soon' : 'ok';
}

module.exports = { businessDaysSince, businessHoursSince, slaFlag, DUE_SOON_HOURS, OVERDUE_HOURS };
