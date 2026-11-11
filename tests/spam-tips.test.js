// Run: node tests/spam-tips.test.js
// The "check your spam / add us to your contacts" lines on sign-up emails and pages.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.MOCK_EMAIL = 'true';
process.env.APP_BASE_URL = 'https://example.test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mail = require('../src/services/emailService');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
async function capture(fn) {
  const real = console.log; let out = '';
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { await fn(); } finally { console.log = real; }
  return out;
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

(async () => {
  await t('the candidate verification email tells them to add us to contacts', async () => {
    const out = await capture(() => mail.sendCandidateVerificationLink('a@example.com', 'Ann', 'tok'));
    assert.ok(out.includes('add noreply@precheckd.com to your contacts'));
    assert.ok(out.includes('/api/candidate/verify-email?token=tok'));
  });
  await t('the recruiter verification email does too', async () => {
    const out = await capture(() => mail.sendVerificationEmail('a@example.com', 'Ann', 'tok'));
    assert.ok(out.includes('add noreply@precheckd.com to your contacts'));
  });
  await t('the password reset email is left alone (it is a security email, nothing extra)', async () => {
    const out = await capture(() => mail.sendPasswordResetEmail('a@example.com', 'Ann', 'tok'));
    assert.ok(!out.includes('to your contacts'));
  });
  await t('pages that say an email was sent also say to check spam', () => {
    assert.ok(read('views/candidate-signup.ejs').includes('check your spam folder'));
    assert.ok(read('views/login.ejs').includes('check your spam folder'));
    assert.ok(read('views/fraud.ejs').includes('including spam'));
    assert.ok(read('views/fraud.ejs').includes('your spam folder if it is not there'));
  });
  console.log(n + ' passed');
})();
