// One-off / cron entry point for the unread-messages digest:
//   npm run digest
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const { runMessageDigest } = require('../src/services/messageDigest');

connectDatabase()
  .then(() => runMessageDigest())
  .then((result) => {
    console.log('Message digest run:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Message digest run failed:', err);
    process.exit(1);
  });
