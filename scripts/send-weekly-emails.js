// One-off / cron entry point for the weekly candidate emails (run hourly;
// each part only acts in its own Monday / Thursday morning window):
//   npm run weekly-emails
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const { runWeeklyRecap, runUnreadMessagesEmail } = require('../src/services/weeklyEmails');

connectDatabase()
  .then(async () => {
    console.log('Weekly recap run:', await runWeeklyRecap());
    console.log('Unread messages run:', await runUnreadMessagesEmail());
    process.exit(0);
  })
  .catch((err) => {
    console.error('Weekly emails run failed:', err);
    process.exit(1);
  });
