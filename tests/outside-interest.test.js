// Run: node tests/outside-interest.test.js
// The "Not in the US?" box: validation, bot trap, rate limit, one row per email.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const OutsideInterest = require('../src/models/OutsideInterest');

const rows = new Map();
OutsideInterest.updateOne = async (q, u) => {
  const cur = rows.get(q.email) || { createdAt: u.$setOnInsert.createdAt };
  rows.set(q.email, Object.assign(cur, u.$set));
};
const router = require('../src/routes/outside-interest');
const post = router.stack.find((l) => l.route && l.route.methods.post).route.stack[0].handle;

function call(body, ip) {
  return new Promise((resolve) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } };
    post({ body, ip: ip || '1.1.1.1' }, res);
  });
}
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const good = { email: 'Anna@Example.ch', country: 'Switzerland', who: 'candidate', page: 'ask' };

(async () => {
  await t('saves a lowercase email with country and role', async () => {
    const r = await call(good, '2.2.2.2');
    assert.deepStrictEqual(r.body, { ok: true });
    assert.strictEqual(rows.get('anna@example.ch').country, 'Switzerland');
    assert.strictEqual(rows.get('anna@example.ch').who, 'candidate');
  });
  await t('the same email twice keeps one row and the newest country', async () => {
    await call({ ...good, country: 'Germany' }, '3.3.3.3');
    assert.strictEqual(rows.size, 1);
    assert.strictEqual(rows.get('anna@example.ch').country, 'Germany');
  });
  await t('rejects a bad email and a missing country', async () => {
    assert.strictEqual((await call({ ...good, email: 'nope' }, '4.4.4.4')).code, 400);
    assert.strictEqual((await call({ ...good, country: ' ' }, '4.4.4.4')).code, 400);
  });
  await t('tells a US visitor to sign up instead of saving them', async () => {
    const r = await call({ ...good, email: 'us@example.com', country: 'USA' }, '5.5.5.5');
    assert.strictEqual(r.code, 400);
    assert.ok(/US/.test(r.body.error));
    assert.ok(!rows.has('us@example.com'));
  });
  await t('an unknown role becomes not-sure', async () => {
    await call({ ...good, email: 'x@example.fr', country: 'France', who: 'admin' }, '6.6.6.6');
    assert.strictEqual(rows.get('x@example.fr').who, 'not-sure');
  });
  await t('the hidden bot field saves nothing but looks like success', async () => {
    const r = await call({ ...good, email: 'bot@example.com', website: 'http://spam' }, '7.7.7.7');
    assert.deepStrictEqual(r.body, { ok: true });
    assert.ok(!rows.has('bot@example.com'));
  });
  await t('a visitor is limited to 5 tries an hour', async () => {
    for (let i = 0; i < 5; i++) await call({ ...good, email: 'r' + i + '@example.com' }, '8.8.8.8');
    assert.strictEqual((await call({ ...good, email: 'r9@example.com' }, '8.8.8.8')).code, 429);
  });
  console.log(n + ' passed');
  process.exit(0);
})();
