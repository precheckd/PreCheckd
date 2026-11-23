// Delete-my-account screen: needs the password and the word DELETE, and only then removes the account.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_x';
const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const Candidate = require('../src/models/Candidate');
const Recruiter = require('../src/models/Recruiter');
const deletion = require('../src/services/accountDeletion');
const emailService = require('../src/services/emailService');
const mails = [];
emailService.sendAccountDeletedEmail = async (to, name) => { mails.push({ to, name }); };

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

const hash = bcrypt.hashSync('correct horse', 4);
const doc = { _id: '507f1f77bcf86cd799439011', email: 'a@x.com', firstName: 'Ann', passwordHash: hash };
Candidate.findById = async () => doc;
Recruiter.findById = async () => doc;
let deleted = [];
deletion.deleteAccount = async (kind, d) => { deleted.push(kind); };

let session = { candidateId: doc._id, destroy(cb) { this.destroyed = true; cb(); } };
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => { req.session = session; next(); });
app.use('/account', require('../src/routes/account-delete'));

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(base + '/account/delete', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  await t('the page explains what is deleted', async () => {
    const r = await fetch(base + '/account/delete'); const h = await r.text();
    assert.strictEqual(r.status, 200); assert(h.includes('permanently deletes') && h.includes('start from scratch') && h.includes('Type DELETE'));
  });
  await t('a wrong password or a missing DELETE deletes nothing', async () => {
    let r = await post({ password: 'nope', confirm: 'DELETE' }); assert.strictEqual(r.status, 400); assert((await r.text()).includes('password is not right'));
    r = await post({ password: 'correct horse', confirm: 'delete' }); assert.strictEqual(r.status, 400); assert((await r.text()).includes('Type DELETE'));
    assert.deepStrictEqual(deleted, []);
  });
  await t('the right password and DELETE removes the account and ends the session', async () => {
    const r = await post({ password: 'correct horse', confirm: 'DELETE' });
    assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), '/account/deleted');
    assert.deepStrictEqual(deleted, ['candidate']); assert.strictEqual(session.destroyed, true);
    assert.deepStrictEqual(mails, [{ to: 'a@x.com', name: 'Ann' }]);
  });
  await t('a recruiter session deletes a recruiter account', async () => {
    deleted = []; session = { recruiterId: doc._id, destroy(cb) { cb(); } };
    const r = await post({ password: 'correct horse', confirm: 'DELETE' });
    assert.strictEqual(r.status, 302); assert.deepStrictEqual(deleted, ['recruiter']);
  });
  await t('a failed deletion tells the person and removes nothing further', async () => {
    deleted = []; session = { candidateId: doc._id, destroy(cb) { cb(); } };
    deletion.deleteAccount = async () => { throw new Error('stripe down'); };
    const r = await post({ password: 'correct horse', confirm: 'DELETE' });
    assert.strictEqual(r.status, 500); assert((await r.text()).includes('nothing was removed'));
    assert.strictEqual(mails.length, 2); // no confirmation for the failed one
  });
  await t('logged-out visitors are sent to log in', async () => {
    session = { destroy(cb) { cb(); } };
    const r = await fetch(base + '/account/delete', { redirect: 'manual' });
    assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), '/login');
  });
  console.log(n + ' passed'); server.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
