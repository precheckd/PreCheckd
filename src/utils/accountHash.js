// One-way hashes for the "deleted account" record. HMAC with the server secret, so the values can't be reversed
// or looked up without it.
const crypto = require('crypto');

const secret = () => process.env.SESSION_SECRET || 'dev-secret-key';
const h = (label, v) => crypto.createHmac('sha256', secret()).update(`${label}:${v}`).digest('hex');

const emailHash = (email) => h('email', String(email || '').trim().toLowerCase());
const phoneHash = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d ? h('phone', d.slice(-10)) : null; };

module.exports = { emailHash, phoneHash };
