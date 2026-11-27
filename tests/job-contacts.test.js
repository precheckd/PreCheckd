// Run: node tests/job-contacts.test.js
// "Who can confirm your jobs": the choices, the contact on a case, the manager's one-time page, the nudges and the screens.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.MOCK_EMAIL = 'true';
process.env.APP_BASE_URL = 'https://example.test';
process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || 'test-secret';
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const mongoose = require('mongoose');
const Candidate = require('../src/models/Candidate');
const VerificationCase = require('../src/models/VerificationCase');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const emailService = require('../src/services/emailService');
const jc = require('../src/services/jobContacts');
const vc = require('../src/services/verificationCases');
const { due } = require('../src/services/jobContactReminders');
const realEmployerEmail = emailService.sendEmployerVerificationEmail;

let n = 0; let failed = 0;
async function t(name, fn) { try { await fn(); n++; console.log('ok  ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
const DAY = 24 * 60 * 60 * 1000;
// The mock mailer prints each message; collect what it printed.
async function captureLog(fn) { const orig = console.log; let out = ''; console.log = (...a) => { out += a.join(' ') + '\n'; }; try { await fn(); } finally { console.log = orig; } return out; }

const mkJob = (extra = {}) => ({ employerName: 'Acme Corp', jobTitle: 'Support Engineer', startDate: '2020-01', endDate: '2023-06', verified: false, ...extra });
const mkCand = (jobs, extra = {}) => new Candidate({ firstName: 'Ann', lastName: 'Lee', slug: 'ann-lee', email: 'ann@home.test', emailVerifiedAt: new Date(), workHistory: jobs, ...extra });

(async () => {
  await t('a job needs an answer until it is verified, on hold, or has a choice and an email', () => {
    assert(jc.needsContact(mkJob()));
    assert(!jc.needsContact(mkJob({ verified: true })));
    assert(!jc.needsContact(mkJob({ contactChoice: 'hold' })));
    assert(jc.needsContact(mkJob({ contactChoice: 'verify' })), 'a choice with no email is still missing');
    assert(!jc.needsContact(mkJob({ contactChoice: 'verify', manager: { email: 'boss@acme.test' } })));
    assert.strictEqual(jc.missingCount(mkCand([mkJob(), mkJob({ verified: true }), mkJob({ contactChoice: 'hold' })])), 1);
  });

  await t('saving a choice and a contact sticks to the right job and survives a save', () => {
    const c = mkCand([mkJob(), mkJob({ employerName: 'Beta LLC' })]);
    const fp = jc.fingerprint(c.workHistory[0]);
    const r = jc.apply(c, [{ fp, choice: 'verify_reference', name: ' Pat  Boss ', email: 'Pat@Acme.test', phone: '555-0100' }]);
    assert.strictEqual(r.changed, 1);
    assert.strictEqual(c.workHistory[0].contactChoice, 'verify_reference');
    assert.deepStrictEqual({ ...c.workHistory[0].manager.toObject() }, { name: 'Pat Boss', email: 'pat@acme.test', phone: '555-0100' });
    assert.strictEqual(c.workHistory[1].contactChoice, null);
  });

  await t('hold clears any contact, and a verified job is never changed', () => {
    const c = mkCand([mkJob({ contactChoice: 'verify', manager: { name: 'X', email: 'x@acme.test' } }), mkJob({ employerName: 'Done Inc', verified: true })]);
    jc.apply(c, [{ fp: jc.fingerprint(c.workHistory[0]), choice: 'hold', email: 'x@acme.test' }, { fp: jc.fingerprint(c.workHistory[1]), choice: 'hold' }]);
    assert.strictEqual(c.workHistory[0].contactChoice, 'hold');
    assert.strictEqual(c.workHistory[0].manager.email, '');
    assert.strictEqual(c.workHistory[1].contactChoice, null);
  });

  await t('bad input is refused: unknown choice, bad email, the candidate\'s own email', () => {
    const c = mkCand([mkJob()]); const fp = jc.fingerprint(c.workHistory[0]);
    assert(jc.apply(c, [{ fp, choice: 'nope' }]).error);
    assert(jc.apply(c, [{ fp, choice: 'verify', email: 'not-an-email' }]).error);
    assert(/own email/.test(jc.apply(c, [{ fp, choice: 'verify', email: 'ANN@home.test' }]).error));
    assert.strictEqual(c.workHistory[0].contactChoice, null);
  });

  await t('an unknown job fingerprint is ignored (a renamed job cannot take another job\'s answer)', () => {
    const c = mkCand([mkJob()]);
    assert.strictEqual(jc.apply(c, [{ fp: 'other|job|2020-01', choice: 'verify', email: 'a@b.test' }]).changed, 0);
  });

  await t('the page form is read in order and stops at the first missing job', () => {
    const rows = jc.parseForm({ job_0_fp: 'a', job_0_choice: 'hold', job_1_fp: 'b', job_1_email: 'x@y.test' });
    assert.strictEqual(rows.length, 2); assert.strictEqual(rows[0].choice, 'hold'); assert.strictEqual(rows[1].choice, null);
  });

  await t('personal email domains are recognised (staff get a heads up)', () => {
    assert(jc.isFreeMail('boss@gmail.com')); assert(!jc.isFreeMail('boss@acme.test'));
  });

  // ---- cases
  let created = null;
  const cand = mkCand([
    mkJob({ contactChoice: 'verify_reference', manager: { name: 'Pat Boss', email: 'pat@acme.test', phone: '555-0100' } }),
    mkJob({ employerName: 'Held Co', contactChoice: 'hold' }),
    mkJob({ employerName: 'Plain Co' }),
    mkJob({ employerName: 'Gmail Co', contactChoice: 'verify', manager: { email: 'friend@gmail.com' } })
  ]);
  cand._id = new mongoose.Types.ObjectId();
  Candidate.findById = async () => cand;
  Message.create = async () => ({}); Notification.create = async () => ({});
  emailService.sendVerificationNoticeEmail = async () => {};
  VerificationCase.create = async (d) => { created = { log: [], ...d, _id: new mongoose.Types.ObjectId(), save: async function () {} }; return created; };
  VerificationCase.findOne = async () => null;

  await t('a case starts with the contact the candidate named and remembers the reference wish', async () => {
    const c = await vc.start(cand, 'workHistory', 0, {});
    assert.strictEqual(c.contact.email, 'pat@acme.test'); assert.strictEqual(c.contact.name, 'Pat Boss'); assert.strictEqual(c.contact.phone, '555-0100');
    assert.strictEqual(c.wantsReference, true);
    assert(c.log.some((l) => /came from the candidate/.test(l.text)));
  });
  await t('a contact typed by staff wins over the candidate\'s', async () => {
    const c = await vc.start(cand, 'workHistory', 0, { email: 'hr@acme.test' });
    assert.strictEqual(c.contact.email, 'hr@acme.test'); assert.strictEqual(c.contact.name, '');
  });
  await t('a job on hold cannot start a case', async () => {
    await assert.rejects(() => vc.start(cand, 'workHistory', 1, { email: 'hr@held.test' }), (e) => e.code === 'on_hold');
  });
  await t('a job with no contact starts like before, and a personal address gets a heads up', async () => {
    const plain = await vc.start(cand, 'workHistory', 2, {});
    assert.strictEqual(plain.contact.email, ''); assert.strictEqual(plain.wantsReference, false);
    const g = await vc.start(cand, 'workHistory', 3, {});
    assert(g.log.some((l) => /personal email address/.test(l.text)));
  });

  // ---- the manager's page
  const caseDoc = (extra = {}) => {
    const id = new mongoose.Types.ObjectId();
    return { _id: id, candidateId: cand._id, category: 'workHistory', subject: 'Acme Corp', detail: 'Support Engineer', dates: '2020-01 to 2023-06', status: 'outreach', wantsReference: true, contactStatus: 'manual', contact: { email: 'pat@acme.test' }, steps: [], log: [], managerAnswer: {}, save: async function () { this.saved = true; }, ...extra };
  };
  const serve = (doc) => { VerificationCase.findById = async () => doc; };
  let alerts = []; emailService.sendStaffAlertEmail = async (a) => { alerts.push(a); };

  await t('the confirm link works for its case and for nothing else', () => {
    const d = caseDoc(); const tok = vc.confirmToken(d);
    assert.strictEqual(vc.caseIdFromToken(tok), String(d._id));
    assert.strictEqual(vc.caseIdFromToken(tok.slice(0, -2) + 'xx'), null);
    assert.strictEqual(vc.caseIdFromToken(String(new mongoose.Types.ObjectId()) + '.' + 'a'.repeat(32)), null);
    assert.strictEqual(vc.caseIdFromToken('garbage'), null);
  });
  await t('opening the link shows the facts, and an education case has no page', async () => {
    const d = caseDoc(); serve(d);
    const r = await vc.answerManager(vc.confirmToken(d));
    assert(r.found && r.info.title === 'Support Engineer' && r.info.name === 'Ann Lee' && r.info.wantsReference);
    const e = caseDoc({ category: 'educationHistory' }); serve(e);
    assert.strictEqual((await vc.answerManager(vc.confirmToken(e))).found, false);
  });
  await t('"accurate" is recorded, confirms the address, alerts staff, and does not verify anything', async () => {
    const d = caseDoc(); serve(d); alerts = [];
    const r = await vc.answerManager(vc.confirmToken(d), { answer: 'accurate', referenceWilling: 'yes' });
    assert(r.answered); assert.strictEqual(d.managerAnswer.answer, 'accurate'); assert.strictEqual(d.managerAnswer.referenceWilling, true);
    assert.strictEqual(d.contactStatus, 'confirmed'); assert.strictEqual(d.status, 'outreach'); assert.strictEqual(alerts.length, 1);
    assert.strictEqual(vc.nextAction(d).kind, 'reply');
  });
  await t('"different" needs a correction, and a second answer is not taken', async () => {
    const d = caseDoc(); serve(d);
    const bad = await vc.answerManager(vc.confirmToken(d), { answer: 'different' });
    assert(bad.needsAnswer && bad.error);
    const ok = await vc.answerManager(vc.confirmToken(d), { answer: 'different', correctedDates: '2020-03 to 2023-06' });
    assert(ok.answered); assert.strictEqual(d.managerAnswer.correctedDates, '2020-03 to 2023-06');
    assert((await vc.answerManager(vc.confirmToken(d), { answer: 'accurate' })).already);
  });
  await t('"cannot confirm" does not confirm the address; no answer picked asks again', async () => {
    const d = caseDoc(); serve(d);
    assert((await vc.answerManager(vc.confirmToken(d), {})).needsAnswer);
    await vc.answerManager(vc.confirmToken(d), { answer: 'cannot' });
    assert.strictEqual(d.contactStatus, 'manual'); assert.strictEqual(d.managerAnswer.answer, 'cannot');
  });
  await t('the reference question is only recorded when the candidate asked for it', async () => {
    const d = caseDoc({ wantsReference: false }); serve(d);
    await vc.answerManager(vc.confirmToken(d), { answer: 'accurate', referenceWilling: 'yes' });
    assert.strictEqual(d.managerAnswer.referenceWilling, null);
  });
  await t('a closed case shows the link as taken care of', async () => {
    const d = caseDoc({ status: 'verified' }); serve(d);
    assert((await vc.answerManager(vc.confirmToken(d), { answer: 'accurate' })).closed);
  });

  await t('the employer emails of a work case carry the confirm link; school emails do not', async () => {
    const sent = []; emailService.sendEmployerVerificationEmail = async (a) => { sent.push(a); };
    const mkDue = (cat) => caseDoc({ category: cat, startedAt: new Date(Date.now() - 30 * DAY), steps: [{ key: 'email1', type: 'email', day: 1, doneAt: null }], authorization: {} });
    for (const cat of ['workHistory', 'educationHistory']) {
      const d = mkDue(cat); VerificationCase.find = async () => [d]; await vc.runDue();
    }
    assert.strictEqual(sent.length, 2);
    assert(/^https:\/\/example\.test\/confirm-job\/[0-9a-f]{24}\./.test(sent[0].confirmUrl));
    assert.strictEqual(sent[1].confirmUrl, null);
  });
  await t('the employer email shows the button only when there is a link', async () => {
    emailService.sendEmployerVerificationEmail = realEmployerEmail;
    const base = { to: 'pat@acme.test', contactName: 'Pat', kind: 'workHistory', candidateName: 'Ann Lee', subject: 'Acme', detail: 'Eng', dates: '2020', attempt: 1 };
    const withLink = await captureLog(() => emailService.sendEmployerVerificationEmail({ ...base, confirmUrl: 'https://example.test/confirm-job/x.y' }));
    const without = await captureLog(() => emailService.sendEmployerVerificationEmail(base));
    assert(withLink.includes('confirm-job/x.y') && withLink.includes('Confirm this record'));
    assert(!without.includes('confirm-job'));
  });

  // ---- nudges
  const NOW = new Date('2026-11-10T15:00:00Z'); // 10:00 ET
  const aged = (days, extra = {}, jobs) => mkCand(jobs || [mkJob()], { createdAt: new Date(NOW.getTime() - days * DAY), ...extra });
  await t('nothing is due on day 0; the bell comes at day 1; the email at day 3', () => {
    assert.deepStrictEqual(due(aged(0.5), NOW), { bell: false, email: false });
    assert.deepStrictEqual(due(aged(1.2), NOW), { bell: true, email: false });
    assert.deepStrictEqual(due(aged(3.2), NOW), { bell: true, email: true });
  });
  await t('each nudge is sent once, and nothing is sent when the jobs are answered or on hold', () => {
    assert.deepStrictEqual(due(aged(3.2, { jobContactNudge: { bellAt: NOW, emailAt: NOW } }), NOW), { bell: false, email: false });
    assert.deepStrictEqual(due(aged(3.2, {}, [mkJob({ contactChoice: 'hold' })]), NOW), { bell: false, email: false });
    assert.deepStrictEqual(due(aged(3.2, {}, [mkJob({ verified: true })]), NOW), { bell: false, email: false });
  });
  await t('no email overnight, to unsubscribed or unverified addresses, or after 60 days; the bell still comes', () => {
    const night = new Date('2026-11-10T07:00:00Z');
    assert.strictEqual(due(aged(3.2), night).email, false);
    assert.strictEqual(due(aged(3.2, { weeklyEmailOptOut: true }), NOW).email, false);
    assert.strictEqual(due(aged(3.2, { emailVerifiedAt: null }), NOW).email, false);
    assert.strictEqual(due(aged(3.2, { weeklyEmailOptOut: true }), NOW).bell, true);
    assert.deepStrictEqual(due(aged(61), NOW), { bell: false, email: false });
  });
  await t('the reminder email links to the page and counts the jobs', async () => {
    const c = aged(3.2, {}, [mkJob(), mkJob({ employerName: 'B' })]); c._id = new mongoose.Types.ObjectId();
    const out = await captureLog(() => emailService.sendJobContactReminderEmail(c, { count: 2 }));
    assert(out.includes('/candidate/ann-lee/job-contacts')); assert(out.includes('2 of your jobs'));
  });

  // ---- screens
  const view = (f, data) => ejs.renderFile(path.join(__dirname, '..', 'views', f), data);
  await t('the page shows the three choices, with the hold choice in red, and skips verified jobs', async () => {
    const c = mkCand([mkJob(), mkJob({ employerName: 'Done Inc', verified: true })]);
    const html = await view('candidate-job-contacts.ejs', { candidate: c, title: 't', choices: jc.CHOICES, fingerprint: jc.fingerprint, error: null, saved: false });
    assert(html.includes('Verify only') && html.includes('Verify and ask for a reference') && html.includes('Do not contact this employer yet'));
    assert(/jc-card jc-hold/.test(html));
    assert(!html.includes('Done Inc'));
    assert.strictEqual((html.match(/type="radio"/g) || []).length, 3);
  });
  await t('the page says so when everything is verified, and shows a saved notice', async () => {
    const c = mkCand([mkJob({ verified: true })]);
    const html = await view('candidate-job-contacts.ejs', { candidate: c, title: 't', choices: jc.CHOICES, fingerprint: jc.fingerprint, error: null, saved: true });
    assert(/All of your jobs are verified/.test(html)); assert(html.includes('Saved.'));
  });
  await t('the setup page offers the contacts step only while a job needs one', async () => {
    const c = mkCand([mkJob()]); c.onboarding = { required: true };
    const { setupProgress } = require('../src/utils/candidateOnboarding');
    const withJob = await view('candidate-setup.ejs', { candidate: c, progress: setupProgress(c), identityDone: true, jobContactsMissing: 1 });
    const none = await view('candidate-setup.ejs', { candidate: c, progress: setupProgress(c), identityDone: true, jobContactsMissing: 0 });
    assert(withJob.includes('/candidate/ann-lee/job-contacts') && /who can confirm your jobs/.test(withJob));
    assert(!none.includes('job-contacts'));
  });
  await t('the manager page asks the reference question only when it was requested', async () => {
    const info = { name: 'Ann Lee', title: 'Eng', employer: 'Acme', dates: '2020 to 2023' };
    const a = await view('job-confirm.ejs', { state: 'ask', info: { ...info, wantsReference: true }, token: 'x.y', error: '' });
    const b = await view('job-confirm.ejs', { state: 'ask', info: { ...info, wantsReference: false }, token: 'x.y', error: '' });
    assert(a.includes('referenceWilling') && !b.includes('referenceWilling'));
    assert((await view('job-confirm.ejs', { state: 'done', info, token: '', error: '' })).includes('Your answer has been recorded'));
  });
  await t('the staff screen shows hold in red and the contact the candidate gave', async () => {
    const c = mkCand([mkJob({ contactChoice: 'hold' }), mkJob({ employerName: 'B', contactChoice: 'verify', manager: { name: 'Pat', email: 'pat@b.test' } })]);
    c._id = new mongoose.Types.ObjectId();
    const html = await view('internal-verify-detail.ejs', { candidate: c, csrfToken: 'x', caseNotice: null, title: 't' });
    assert(html.includes('DO NOT CONTACT')); assert(html.includes('pat@b.test'));
    assert(!/Start verification case[\s\S]*Held/.test(html.split('Held')[0] || ''));
  });

  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
