// Signed, per-candidate unsubscribe links for the weekly emails. The token is
// "<candidateId>.<signature>"; the signature can't be forged without the
// server secret, so a link only ever works for the candidate it was made for.
const crypto = require('crypto');

function secret() {
  return process.env.SESSION_SECRET || 'dev-secret-key';
}

function sign(candidateId) {
  return crypto.createHmac('sha256', secret()).update(`weekly-unsub:${candidateId}`).digest('hex').slice(0, 32);
}

function makeUnsubscribeToken(candidateId) {
  return `${candidateId}.${sign(candidateId)}`;
}

// Returns the candidate id for a valid token, otherwise null.
function readUnsubscribeToken(token) {
  const [id, signature] = String(token || '').split('.');
  if (!id || !signature || !/^[a-f0-9]{24}$/i.test(id)) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return id;
}

function unsubscribeUrl(candidateId) {
  return `${process.env.APP_BASE_URL}/email/unsubscribe/${makeUnsubscribeToken(candidateId)}`;
}

module.exports = { makeUnsubscribeToken, readUnsubscribeToken, unsubscribeUrl };
