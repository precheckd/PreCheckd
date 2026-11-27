// Delete my account: Stripe first, then files, then every record the account owns, leaving only a hashed record.
const assert = require('assert');
const mongoose = require('mongoose');
const svc = require('../src/services/accountDeletion');
const DeletedAccount = require('../src/models/DeletedAccount');
const { emailHash, phoneHash } = require('../src/utils/accountHash');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

const calls = [];
const M = (n) => require(`../src/models/${n}`);
const names = ['Application', 'CreditRequest', 'FinalistTest', 'JobApplication', 'JobInvite', 'JobNotice', 'SkillRequest', 'SkillResult', 'TestRequest',
  'ProfileView', 'SavedRecruiter', 'JobPosting', 'JobDraft', 'OutreachMessage', 'OutreachBlock', 'BillingEvent', 'FeedItem', 'InboundEmail', 'MailAlias',
  'MailBlock', 'MailMessage', 'MailReport', 'Notification', 'PageView', 'RelationshipNote', 'VerificationCase', 'CatalogRequest', 'FraudReport', 'FoundingInvite', 'Message', 'ConnectionRequest', 'StaffNote'];
let msgs = [];
const connId = new mongoose.Types.ObjectId();
for (const n of names) {
  const m = M(n);
  m.deleteMany = async (q) => { calls.push(`del ${n} ${JSON.stringify(q)}`); };
  m.updateMany = async (q) => { calls.push(`upd ${n}`); };
  m.find = (q) => ({ select: async () => (n === 'ConnectionRequest' ? [{ _id: connId }] : n === 'Message' ? msgs : []), then: undefined });
}
M('VerificationCase').find = async () => [{ _id: new mongoose.Types.ObjectId() }];
let tomb = null;
DeletedAccount.create = async (d) => { calls.push('tombstone'); tomb = d; };
DeletedAccount.find = async () => tomb ? [tomb] : [];

const mkDoc = (extra = {}) => { const id = new mongoose.Types.ObjectId(); const d = { _id: id, email: 'A@x.com', phone: '+1 (555) 123-4567', billing: {}, constructor: { deleteOne: async () => { calls.push('account'); } }, ...extra }; return d; };

(async () => {
  await t('Stripe goes first, then files, records and the account; a hashed record is left', async () => {
    calls.length = 0; tomb = null;
    const stripeCalls = [];
    const stripe = { customers: { del: async (id) => { stripeCalls.push(id); calls.push('stripe'); } }, identity: { verificationSessions: { redact: async (id) => { stripeCalls.push('redact ' + id); } } } };
    const gone = [];
    const s3 = { deleteS3Object: async (u) => gone.push(u), deletePrivateObject: async (k) => gone.push(k) };
    msgs = [{ attachments: [{ key: 'verification-docs/1.pdf' }] }];
    const doc = mkDoc({ billing: { customerId: 'cus_1', verificationFee: { waived: true } }, stripeVerificationSessionId: 'vs_1', profilePhotoUrl: 'https://b/photo', resumeUrl: 'https://b/cv', interviewVideos: [{ videoUrl: 'https://b/v1' }] });
    await svc.deleteAccount('candidate', doc, { stripe, s3 });
    assert.strictEqual(calls[0], 'stripe');
    assert.deepStrictEqual(stripeCalls, ['cus_1', 'redact vs_1']);
    assert.deepStrictEqual(gone.sort(), ['https://b/cv', 'https://b/photo', 'https://b/v1', 'verification-docs/1.pdf'].sort());
    assert(calls.some((c) => c.startsWith('del Message')) && calls.some((c) => c.startsWith('del ConnectionRequest')) && calls.some((c) => c.startsWith('del SkillResult')));
    assert(calls.indexOf('tombstone') < calls.indexOf('account'));
    assert.strictEqual(tomb.emailHash, emailHash('a@x.com')); assert.strictEqual(tomb.phoneHash, phoneHash('5551234567'));
    assert.strictEqual(tomb.hadWaivedFee, true); assert.strictEqual(tomb.blocked, false);
    assert(!JSON.stringify(tomb).includes('a@x.com') && !JSON.stringify(tomb).includes('5551234567'));
  });
  await t('if Stripe fails, nothing is deleted', async () => {
    calls.length = 0; tomb = null;
    const stripe = { customers: { del: async () => { throw new Error('stripe down'); } } };
    await assert.rejects(() => svc.deleteAccount('recruiter', mkDoc({ billing: { customerId: 'cus_2' } }), { stripe }), /stripe down/);
    assert.deepStrictEqual(calls, []); assert.strictEqual(tomb, null);
  });
  await t('a suspended recruiter is blocked from coming back; a free year is remembered', async () => {
    calls.length = 0; tomb = null; msgs = [];
    await svc.deleteAccount('recruiter', mkDoc({ isSuspended: true, billing: { freeYear: { startedAt: new Date() } } }), {});
    assert.strictEqual(tomb.blocked, true); assert.strictEqual(tomb.hadFreeYear, true);
    assert(calls.some((c) => c.startsWith('del JobPosting')) && calls.some((c) => c.startsWith('upd FoundingInvite')));
    const p = await svc.previous({ email: 'a@x.com' });
    assert.strictEqual(p.blocked, true); assert.strictEqual(p.hadFreeYear, true);
  });
  await t('a normal candidate is not blocked, and a stranger has no history', async () => {
    calls.length = 0; tomb = null; msgs = [];
    await svc.deleteAccount('candidate', mkDoc(), {});
    assert.strictEqual(tomb.blocked, false);
    tomb = null;
    assert.strictEqual(await svc.previous({ email: 'new@x.com' }), null);
  });
  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
