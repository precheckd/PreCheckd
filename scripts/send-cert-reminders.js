// One-off / cron entry point for certification expiry reminders:
//   npm run cert-reminders
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const { runCertExpiryReminders } = require('../src/services/certExpiryReminders');

connectDatabase()
  .then(() => runCertExpiryReminders())
  .then((result) => {
    console.log('Cert expiry reminder run:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Cert expiry reminder run failed:', err);
    process.exit(1);
  });
