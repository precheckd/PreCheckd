const crypto = require('crypto');
const axios = require('axios');
const config = require('../config/sumsub');

function sign(ts, method, path, body) {
  const hmac = crypto.createHmac('sha256', config.secretKey);
  hmac.update(ts + method.toUpperCase() + path);
  if (body) {
    hmac.update(Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
  }
  return hmac.digest('hex');
}

async function request(method, path, body) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const headers = {
    'X-App-Token': config.appToken,
    'X-App-Access-Sig': sign(ts, method, path, body),
    'X-App-Access-Ts': ts,
  };
  const response = await axios({
    method,
    url: config.baseUrl + path,
    headers,
    data: body,
  });
  return response.data;
}

async function createApplicant(externalUserId) {
  return request('post', `/resources/applicants?levelName=${encodeURIComponent(config.levelName)}`, {
    externalUserId,
  });
}

async function getApplicantStatus(applicantId) {
  return request('get', `/resources/applicants/${applicantId}/status`);
}

async function generateAccessToken(externalUserId) {
  return request(
    'post',
    `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(
      config.levelName
    )}`
  );
}

function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

module.exports = {
  createApplicant,
  getApplicantStatus,
  generateAccessToken,
  verifyWebhookSignature,
};
