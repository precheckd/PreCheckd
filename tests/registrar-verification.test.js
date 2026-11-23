// School verification: the signed authorization, the date of birth rules, and how a case uses the school directory.
const assert = require('assert');
const mongoose = require('mongoose');
const auth = require('../src/services/releaseAuthorization');
const dob = require('../src/services/educationDob');
const vc = require('../src/services/verificationCases');
const VerificationCase = require('../src/models/VerificationCase');
const Candidate = require('../src/models/Candidate');
const School = require('../src/models/School');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const emailService = require('../src/services/emailService');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

(async () => {
  await t('the authorization needs the box and the full name typed', () => {
    const ok = auth.record({ accepted: 'yes', typedName: 'Ann  Lee', firstName: 'Ann', lastName: 'Lee', ip: '1.2.3.4' });
    assert.strictEqual(ok.value.typedName, 'Ann  Lee'); assert.strictEqual(ok.value.version, auth.VERSION); assert(ok.value.acceptedAt);
    assert(auth.record({ accepted: undefined, typedName: 'Ann Lee', firstName: 'Ann', lastName: 'Lee' }).error);
    assert(auth.record({ accepted: 'yes', typedName: 'Ann', firstName: 'Ann', lastName: 'Lee' }).error);
    assert(auth.record({ accepted: 'yes', typedName: 'Bob Smith', firstName: 'Ann', lastName: 'Lee' }).error);
  });
  await t('the registrar PDF names the graduate, school and signature, and never a date of birth', async () => {
    const pdf = await auth.pdfFor({ candidate: { firstName: 'Ann', lastName: 'Lee', verificationDob: '1990-01-02', releaseAuthorization: { typedName: 'Ann Lee', acceptedAt: new Date('2026-11-22T12:00:00Z'), version: 1 } }, subject: 'Western Governors University', detail: 'B.S. Computer Science', dates: '2022-05', caseId: 'abcdef123456' });
    assert.strictEqual(pdf.slice(0, 4).toString(), '%PDF'); assert(pdf.length > 1000);
    assert(!pdf.toString('latin1').includes('1990'));
  });
  await t('a date of birth must be a real date and a plausible age', () => {
    assert.strictEqual(dob.validate('1990-02-28'), '1990-02-28');
    assert.strictEqual(dob.validate('1990-02-30'), null); assert.strictEqual(dob.validate('2024-01-01'), null); assert.strictEqual(dob.validate('nope'), null);
  });
  await t('the DOB is needed while a degree is unverified, and asked again when a new degree is added', () => {
    assert(!dob.needsDob({ educationHistory: [] }));
    assert(dob.needsDob({ educationHistory: [{ verified: false }], verificationDob: null }));
    assert(!dob.needsDob({ educationHistory: [{ verified: false }], verificationDob: '1990-02-28' }));
    assert(!dob.needsDob({ educationHistory: [{ verified: true }], verificationDob: null }));
  });
  await t('the DOB is deleted once no degree check is left, and kept while one is', async () => {
    let open = 1; let closed = [];
    VerificationCase.countDocuments = async () => open;
    VerificationCase.find = () => ({ select: async () => closed });
    const mk = (extra = {}) => ({ _id: 'c1', verificationDob: '1990-02-28', verificationPriorNames: 'Ann Smith', educationHistory: [{ schoolName: 'WGU', degree: 'BS', verified: true }], save: async function () { this.saved = true; }, ...extra });
    let cand = mk(); assert.strictEqual(await dob.purgeIfDone(cand), false); assert.strictEqual(cand.verificationDob, '1990-02-28');
    open = 0; cand = mk(); assert.strictEqual(await dob.purgeIfDone(cand), true);
    assert.strictEqual(cand.verificationDob, null); assert.strictEqual(cand.verificationPriorNames, null);
    // a second degree that has no case yet still needs it
    cand = mk({ educationHistory: [{ schoolName: 'WGU', degree: 'BS', verified: true }, { schoolName: 'NYU', degree: 'MS', verified: false }] });
    assert.strictEqual(await dob.purgeIfDone(cand), false);
    // ...unless that one was already tried and closed
    closed = [{ subject: 'NYU', detail: 'MS' }]; cand = mk({ educationHistory: [{ schoolName: 'NYU', degree: 'MS', verified: false }] });
    assert.strictEqual(await dob.purgeIfDone(cand), true);
  });

  // ---- cases
  const schoolId = new mongoose.Types.ObjectId();
  let school = { _id: schoolId, registrarEmail: 'registrar@wgu.edu', registrarPhone: '800-555-0100', emailStatus: 'guessed' };
  const cand = { _id: new mongoose.Types.ObjectId(), firstName: 'Ann', lastName: 'Lee', email: 'ann@x.com', verificationDob: '1990-02-28', verificationPriorNames: 'Ann Smith',
    releaseAuthorization: { version: 1, typedName: 'Ann Lee', acceptedAt: new Date('2026-11-01T00:00:00Z') },
    educationHistory: [{ schoolName: 'Western Governors University', degree: 'B.S. Computer Science', graduationDate: '2022-05', schoolId, verified: false }], async save() {}, markModified() {} };
  Candidate.findById = async () => cand;
  School.findById = async () => school;
  const schoolWrites = []; School.updateOne = async (q, u) => { schoolWrites.push({ q, u }); }; School.updateMany = async (q, u) => { schoolWrites.push({ q, u }); };
  Message.create = async () => ({}); Notification.create = async () => ({});
  emailService.sendVerificationNoticeEmail = async () => {};
  let created = null;
  VerificationCase.create = async (d) => { created = { log: [], ...d, _id: new mongoose.Types.ObjectId(), save: async function () {} }; return created; };
  VerificationCase.findOne = async () => null;

  await t('a case for a directory school starts with its registrar address and says how sure we are of it', async () => {
    const c = await vc.start(cand, 'educationHistory', 0, {});
    assert.strictEqual(c.contact.email, 'registrar@wgu.edu'); assert.strictEqual(c.contactStatus, 'guessed'); assert.strictEqual(String(c.schoolId), String(schoolId));
    assert.strictEqual(c.authorization.typedName, 'Ann Lee');
  });
  await t('staff can still type their own address, and a school needing research gives none', async () => {
    let c = await vc.start(cand, 'educationHistory', 0, { email: 'records@wgu.edu' });
    assert.strictEqual(c.contact.email, 'records@wgu.edu'); assert.strictEqual(c.contactStatus, 'manual');
    school = { ...school, emailStatus: 'needs_research' };
    c = await vc.start(cand, 'educationHistory', 0, {}); assert.strictEqual(c.contact.email, '');
    school = { ...school, emailStatus: 'guessed' };
  });

  const sent = [];
  emailService.sendEmployerVerificationEmail = async (p) => { sent.push(p); };
  const dueCase = (status) => ({ _id: new mongoose.Types.ObjectId(), candidateId: cand._id, category: 'educationHistory', subject: 'WGU', detail: 'BS', dates: '2022-05', status: 'outreach',
    contact: { email: 'registrar@wgu.edu', name: '', phone: '' }, contactStatus: status, startedAt: new Date(Date.now() - 20 * 86400000),
    authorization: { version: 1, typedName: 'Ann Lee', acceptedAt: new Date('2026-11-01T00:00:00Z') },
    steps: [{ key: 'email1', type: 'email', day: 1, doneAt: null }], log: [], async save() {} });
  await t('a guessed address gets the request and the signed authorization but no date of birth', async () => {
    sent.length = 0; VerificationCase.find = async () => [dueCase('guessed')];
    await vc.runDue();
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].dob, null); assert.strictEqual(sent[0].dobPending, true);
    assert(sent[0].pdf && sent[0].pdf.slice(0, 4).toString() === '%PDF'); assert(sent[0].authorizedOn);
  });
  await t('a confirmed address also gets the date of birth and other names', async () => {
    sent.length = 0; VerificationCase.find = async () => [dueCase('confirmed')];
    await vc.runDue();
    assert.strictEqual(sent[0].dob, '1990-02-28'); assert.strictEqual(sent[0].priorNames, 'Ann Smith'); assert.strictEqual(sent[0].dobPending, false);
  });
  await t('the request email reads like a registrar letter and attaches the authorization', async () => {
    const real = require('../src/services/emailService');
    const orig = real.sendEmployerVerificationEmail; delete real.sendEmployerVerificationEmail;
    // render through the real function with email in mock mode
    delete require.cache[require.resolve('../src/services/emailService')];
    process.env.MOCK_EMAIL = 'true';
    const fresh = require('../src/services/emailService');
    const logs = []; const log = console.log; console.log = (...a) => logs.push(a.join(' '));
    await fresh.sendEmployerVerificationEmail({ to: 'registrar@wgu.edu', kind: 'educationHistory', candidateName: 'Ann Lee', subject: 'WGU', detail: 'B.S. CS', dates: '2022-05', attempt: 1, authorizedOn: new Date('2026-11-01'), pdf: Buffer.from('%PDF-x'), dob: '1990-02-28', priorNames: 'Ann Smith', dobPending: false });
    console.log = log;
    const html = logs.join('\n');
    assert(html.includes('Dear Office of the Registrar') && html.includes('authorized this request electronically on 2026-11-01') && html.includes('1990-02-28') && html.includes('Ann Smith'));
    real.sendEmployerVerificationEmail = orig;
  });
  await t('a person replying confirms the address on the case and in the directory', async () => {
    schoolWrites.length = 0; const c = dueCase('guessed'); c.schoolId = schoolId;
    await vc.confirmContact(c);
    assert.strictEqual(c.contactStatus, 'confirmed'); assert(schoolWrites.some((w) => w.u.$set.emailStatus === 'confirmed'));
  });
  await t('a hard bounce sends the school back to research and clears the address on open cases', async () => {
    schoolWrites.length = 0; const c = dueCase('guessed'); VerificationCase.find = async () => [c];
    await vc.addressBounced('Registrar@WGU.edu');
    assert(schoolWrites.some((w) => w.u.$set.emailStatus === 'needs_research')); assert.strictEqual(c.contact.email, ''); assert.strictEqual(c.contactStatus, 'manual');
  });
  await t('closing the last degree check deletes the date of birth', async () => {
    const c = dueCase('confirmed'); c.category = 'educationHistory'; c.subject = 'Western Governors University'; c.detail = 'B.S. Computer Science';
    VerificationCase.countDocuments = async () => 0; VerificationCase.find = () => ({ select: async () => [{ subject: c.subject, detail: c.detail }] });
    const saves = []; cand.save = async function () { saves.push(1); };
    await vc.resolve(c, 'unable');
    assert.strictEqual(cand.verificationDob, null); assert.strictEqual(cand.verificationPriorNames, null);
  });

  // ---- directory import and search
  const imp = require('../src/services/schoolImport');
  const resolver = { resolveMx: async (d) => { if (d === 'nomail.edu') throw new Error('ENODATA'); return [{ exchange: 'mx.' + d, priority: 10 }]; } };
  await t('import: a site-sourced address is confirmed, a mail-accepting domain is guessed, otherwise research', async () => {
    const a = await imp.classify({ name: 'WGU', website: 'https://www.wgu.edu/about', registrarEmail: 'Records@wgu.edu', sourceUrl: 'https://wgu.edu/records' }, resolver);
    assert.strictEqual(a.emailStatus, 'confirmed'); assert.strictEqual(a.registrarEmail, 'records@wgu.edu'); assert.strictEqual(a.domain, 'wgu.edu');
    const b = await imp.classify({ name: 'State U', website: 'state.edu' }, resolver);
    assert.strictEqual(b.emailStatus, 'guessed'); assert.strictEqual(b.registrarEmail, 'registrar@state.edu');
    const c = await imp.classify({ name: 'No Mail', website: 'nomail.edu' }, resolver); assert.strictEqual(c.emailStatus, 'needs_research'); assert.strictEqual(c.registrarEmail, '');
    const d = await imp.classify({ name: 'Unsourced', website: 'x.edu', registrarEmail: 'a@x.edu' }, resolver); assert.strictEqual(d.emailStatus, 'guessed'); // an address with no source is not trusted
  });
  await t('import: a confirmed address is never overwritten by a guess', async () => {
    const saved = []; const row = { emailStatus: 'confirmed', registrarEmail: 'real@wgu.edu', save: async () => saved.push(1) };
    School.findOne = async () => row; School.create = async () => { throw new Error('should update'); };
    const r = await imp.importRows([{ name: 'WGU', website: 'wgu.edu' }, { name: '' }], { resolver });
    assert.strictEqual(r.skipped, 2); assert.strictEqual(row.registrarEmail, 'real@wgu.edu'); assert.strictEqual(saved.length, 0);
  });
  await t('search suggests by name and links an entry to its school', async () => {
    const svc = require('../src/services/schools');
    School.find = (q) => ({ select: () => ({ limit: async () => [{ _id: 'a', name: 'Western Governors University' }, { _id: 'b', name: 'Governors State University' }], then: undefined }) });
    const found = await svc.suggest('governors');
    assert.strictEqual(found.length, 2); assert.strictEqual(found[0].name, 'Governors State University'); assert(!('registrarEmail' in found[0]));
    School.find = () => ({ select: async () => [{ nameKey: School.keyOf('Western Governors University'), _id: 'a' }] });
    const entries = [{ schoolName: 'western governors university' }, { schoolName: 'Unknown College' }];
    await svc.link(entries); assert.strictEqual(entries[0].schoolId, 'a'); assert.strictEqual(entries[1].schoolId, null);
  });
  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
