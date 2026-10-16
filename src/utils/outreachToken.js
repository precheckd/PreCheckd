// Signed link for the recipient's choices on an outreach email. The token is
// "<outreachMessageId>.<signature>"; it only ever works for that one message,
// so it can't be forged or used to act on anyone else's.
const crypto = require('crypto');

function secret() { return process.env.SESSION_SECRET || 'dev-secret-key'; }
function sign(id) { return crypto.createHmac('sha256', secret()).update(`outreach-choice:${id}`).digest('hex').slice(0, 32); }

function makeOutreachToken(id) { return `${id}.${sign(String(id))}`; }

// Returns the outreach message id for a valid token, else null.
function readOutreachToken(token) {
  const [id, signature] = String(token || '').split('.');
  if (!id || !signature || !/^[a-f0-9]{24}$/i.test(id)) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return id;
}

function outreachChoiceUrl(id) {
  return `${process.env.APP_BASE_URL || 'https://precheckd.com'}/outreach/choice/${makeOutreachToken(id)}`;
}

module.exports = { makeOutreachToken, readOutreachToken, outreachChoiceUrl };
