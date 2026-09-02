const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

module.exports = {
  client,
  verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
};
