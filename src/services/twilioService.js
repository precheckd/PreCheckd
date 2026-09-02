const { client, verifyServiceSid } = require('../config/twilio');

async function startVerification(phone) {
  return client.verify.v2
    .services(verifyServiceSid)
    .verifications.create({ to: phone, channel: 'sms' });
}

async function checkVerification(phone, code) {
  return client.verify.v2
    .services(verifyServiceSid)
    .verificationChecks.create({ to: phone, code });
}

module.exports = { startVerification, checkVerification };
