// Run: node tests/staff-notes.test.js
// Running staff notes: validation, timeline, search, conduct flag, deletion with the account, and the screens.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.MOCK_EMAIL = 'true';
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const mongoose = require('mongoose');
const StaffNote = require('../src/models/StaffNote');
const Candidate = require('../src/models/Candidate');
const Recruiter = require('../src/models/Recruiter');
const VerificationCase = require('../src/models/VerificationCase');
const sn = require('../src/services/staffNotes');

let n = 0; let failed = 0;
async function t(name, fn) { try { await fn(); n++; console.log('ok  ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
const oid = () => new mongoose.Types.ObjectId();
const view = (f, data) => ejs.renderFile(path.join(__dirname, '..', 'views', f), data);
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };

const candId = oid(), recId = oid();
let store = [];
Candidate.exists = async (q) => (String(q._id) === String(candId) ? { _id: candId } : null);
Recruiter.exists = async (q) => (String(q._id) === String(recId) ? { _id: recId } : null);
StaffNote.create = async (d) => { const row = { _id: oid(), createdAt: new Date(Date.now() + store.length), ...d }; store.push(row); return row; };
const matchRow = (r, q) => Object.keys(q).every((k) => {
  if (k === '$or') return q.$or.some((o) => matchRow(r, o));
  const v = q[k];
  if (v && v.$in) return v.$in.map(String).includes(String(r[k]));
  if (v instanceof RegExp) return v.test(r[k] || '');
  return String(r[k]) === String(v);
});
StaffNote.find = (q) => { let rows = store.filter((r) => matchRow(r, q)); const c = { sort: () => { rows = rows.slice().sort((a, b) => b.createdAt - a.createdAt); return c; }, limit: (m) => { rows = rows.slice(0, m); return c; }, lean: async () => rows }; return c; };
StaffNote.distinct = async (field, q) => [...new Set(store.filter((r) => matchRow(r, q)).map((r) => r[field]))];
StaffNote.deleteMany = async (q) => { const before = store.length; store = store.filter((r) => !matchRow(r, q)); return { deletedCount: before - store.length }; };
const chain = (rows) => ({ select: () => ({ limit: () => ({ lean: async () => rows }), lean: async () => rows }) });
Candidate.find = () => chain([{ _id: candId, firstName: 'Ann', lastName: 'Lee', email: 'ann@home.test' }]);
Recruiter.find = () => chain([{ _id: recId, firstName: 'Rob', lastName: 'Ray', email: 'rob@firm.test', company: 'Firm' }]);
const logCase = { _id: oid(), subject: 'Acme', category: 'workHistory', log: [{ at: new Date(Date.now() - 1000), text: 'Emailed employer' }] };
VerificationCase.find = () => ({ select: async () => [logCase] });

(async () => {
  await t('add trims, stores, and ties a call outcome only to calls', async () => {
    const a = await sn.add({ subjectType: 'candidate', subjectId: candId, kind: 'call', outcome: 'reached', text: '  Spoke to HR  ' });
    assert.strictEqual(a.text, 'Spoke to HR'); assert.strictEqual(a.outcome, 'reached');
    const b = await sn.add({ subjectType: 'candidate', subjectId: candId, kind: 'note', outcome: 'reached', text: 'x' });
    assert.strictEqual(b.outcome, '');
  });
  await t('add rejects empty, too long, bad kind, bad outcome, unknown account', async () => {
    const base = { subjectType: 'candidate', subjectId: candId, text: 'ok' };
    assert.strictEqual(await code(sn.add({ ...base, text: '   ' })), 'empty');
    assert.strictEqual(await code(sn.add({ ...base, text: 'a'.repeat(2001) })), 'long');
    assert.strictEqual(await code(sn.add({ ...base, kind: 'gossip' })), 'kind');
    assert.strictEqual(await code(sn.add({ ...base, kind: 'call', outcome: 'maybe' })), 'outcome');
    assert.strictEqual(await code(sn.add({ ...base, subjectId: oid() })), 'subject');
    assert.strictEqual(await code(sn.add({ ...base, subjectType: 'admin' })), 'subject');
  });
  await t('notes on a case show up on the case and on the candidate', async () => {
    const cid = oid();
    await sn.add({ subjectType: 'candidate', subjectId: candId, caseId: cid, text: 'case note' });
    assert.strictEqual((await sn.forSubject('candidate', candId, { caseId: cid })).length, 1);
    assert((await sn.forSubject('candidate', candId)).length >= 3);
  });
  await t('the candidate timeline merges case log lines and is newest first', async () => {
    const items = await sn.candidateTimeline(candId);
    assert(items.some((i) => i.source === 'case log' && i.text === 'Emailed employer'));
    for (let i = 1; i < items.length; i++) assert(new Date(items[i - 1].at) >= new Date(items[i].at));
  });
  await t('conduct flag: only accounts with a conduct note', async () => {
    assert.strictEqual((await sn.conductIds('candidate', [String(candId)])).size, 0);
    await sn.add({ subjectType: 'candidate', subjectId: candId, kind: 'conduct', text: 'Sent abusive message on 3/1' });
    assert((await sn.conductIds('candidate', [String(candId)])).has(String(candId)));
    assert.strictEqual((await sn.conductIds('recruiter', [String(candId)])).size, 0);
    assert.strictEqual((await sn.conductIds('candidate', [])).size, 0);
  });
  await t('search finds accounts and notes, flags conduct, and filters by kind', async () => {
    const r = await sn.search({ q: 'ann' });
    assert(r.people.some((p) => p.type === 'candidate' && p.conduct));
    assert(r.notes.every((x) => x.subjectName === 'Ann Lee'));
    const only = await sn.search({ q: '', kind: 'conduct' });
    assert(only.notes.length === 1 && only.notes[0].kind === 'conduct');
    await sn.search({ q: 'a.*(' }); // regex characters are escaped, so this must not throw
  });
  await t('deleteFor removes only that account\'s notes', async () => {
    await sn.add({ subjectType: 'recruiter', subjectId: recId, text: 'keep me' });
    await sn.deleteFor('candidate', candId);
    assert.strictEqual((await sn.forSubject('candidate', candId)).length, 0);
    assert.strictEqual((await sn.forSubject('recruiter', recId)).length, 1);
  });
  await t('deleting an account deletes its notes', async () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'src/services/accountDeletion.js'), 'utf8');
    assert(/StaffNote'\)\.deleteMany\(\{ subjectType: kind, subjectId: id \}\)/.test(src));
  });
  await t('redirect after a note only goes to a path on this site', () => {
    const { safeBack } = require('../src/routes/internal');
    assert.strictEqual(safeBack('/people/candidate/1', '/notes'), '/people/candidate/1');
    for (const bad of ['//evil.test', 'https://evil.test', 'javascript:alert(1)', '', undefined, '/a b']) assert.strictEqual(safeBack(bad, '/notes'), '/notes');
  });
  const common = { csrfToken: 'tok', kinds: sn.KINDS, outcomes: sn.OUTCOMES, noteMsg: '', noteSaved: false };
  await t('the panel shows the facts-only rule, the csrf token and escapes text', async () => {
    const items = [{ at: new Date(), kind: 'conduct', text: '<script>x</script>', source: 'note' }];
    const html = await ejs.renderFile(path.join(__dirname, '..', 'views/partials/internal-notes-panel.ejs'), { ...common, subjectType: 'candidate', subjectId: String(candId), caseId: '', items, redirectTo: '/notes', heading: 'H' });
    assert(html.includes('Facts only: what happened, and when')); assert(html.includes('value="tok"'));
    assert(!html.includes('<script>x</script>') && html.includes('&lt;script&gt;'));
  });
  await t('person page: conduct banner, suspend form for recruiters, verify link for candidates', async () => {
    const rec = { _id: recId, firstName: 'Rob', lastName: 'Ray', email: 'rob@firm.test', company: 'Firm', isSuspended: false };
    const r = await view('internal-person.ejs', { ...common, type: 'recruiter', doc: rec, items: [], conductCount: 1, title: 't' });
    assert(r.includes('Conduct notes on file: 1')); assert(r.includes('/recruiter/' + recId + '/suspend'));
    const c = await view('internal-person.ejs', { ...common, type: 'candidate', doc: { _id: candId, firstName: 'Ann', lastName: 'Lee', email: 'a@b.test' }, items: [], conductCount: 0, title: 't' });
    assert(c.includes('/verify/' + candId) && !c.includes('Conduct notes on file'));
  });
  await t('notes search page renders results with a red conduct badge', async () => {
    const result = { people: [{ type: 'candidate', id: String(candId), name: 'Ann Lee', detail: 'a@b.test', conduct: true }], notes: [{ subjectType: 'candidate', subjectId: String(candId), subjectName: 'Ann Lee', kind: 'call', outcome: 'none', text: 'No answer', createdAt: new Date() }] };
    const h = await view('internal-notes.ejs', { q: 'ann', kind: '', kinds: sn.KINDS, outcomes: sn.OUTCOMES, result, title: 't' });
    assert(h.includes('nt-tag conduct') && h.includes('Call: No answer') && h.includes('/people/candidate/' + candId));
  });

  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
