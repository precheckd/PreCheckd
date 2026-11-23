// "Connections who already qualify" and inviting them to apply.
const assert = require('assert');
const ConnectionRequest = require('../src/models/ConnectionRequest');
const JobApplication = require('../src/models/JobApplication');
const JobInvite = require('../src/models/JobInvite');
const Notification = require('../src/models/Notification');
const cm = require('../src/services/connectionMatches');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

const NOW = new Date('2026-10-22T12:00:00Z').getTime();
const ago = (d) => new Date(NOW - d * 86400000);
const posting = { _id: 'p1', title: 'Support Engineer', hiringCompany: 'Acme', toGateShape: () => ({
  status: 'open', closeDate: new Date(NOW + 20 * 86400000), skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }],
  education: null, certGroups: [], clearance: null, shift: 'flexible', arrangement: 'remote', startDate: null, startFirm: false }) };

const person = (id, over = {}) => ({ _id: id, firstName: id, email: id + '@example.com', lastName: 'X', emailVerifiedAt: new Date(), isPhoneVerified: true, isIdentityVerified: true,
  educationHistory: [], certifications: [], hiddenSkillKeys: [], shifts: [], ...over });
const skillsOf = { good: [{ key: 'linux', label: 'Linux', level: 'Intermediate', takenAt: ago(30) }], low: [{ key: 'linux', label: 'Linux', level: 'Developing', takenAt: ago(30) }] };
const loadSkills = async (id) => (id === 'low' ? skillsOf.low : id === 'none' ? [] : skillsOf.good);

let counted = 0;
let applied = [], invites = [], created = [], deleted = [], notes = [];
const people = () => [person('good'), person('hider', { hiddenSkillKeys: ['linux'] }), person('low'), person('none'), person('away', { openToOpportunities: false }),
  person('unverified', { isIdentityVerified: false }), person('applied'), person('invited')];
const setup = () => {
  applied = [{ candidateId: 'applied', status: 'submitted' }]; invites = [{ candidateId: 'invited' }]; created = []; deleted = []; notes = [];
  ConnectionRequest.find = () => ({ populate: async () => people().map((c) => ({ _id: 'c-' + c._id, candidateId: c })) });
  JobApplication.find = async () => applied;
  JobInvite.find = async () => invites;
  JobInvite.countDocuments = async () => counted;
  JobInvite.create = async (d) => { created.push(d.candidateId); };
  JobInvite.deleteOne = async (q) => { deleted.push(q.candidateId); };
  Notification.create = async (n) => { notes.push(n); return n; };
};

(async () => {
  await t('only connections who qualify on shown skills are listed', async () => {
    setup();
    const r = await cm.forPosting('r1', posting, { now: NOW, loadSkills });
    assert.deepStrictEqual(r.qualifying.map((q) => q.candidate._id), ['good']);
    assert(r.invited.has('invited'));
  });
  await t('a hidden skill never makes someone qualify, and never shows up in the list', async () => {
    setup();
    const r = await cm.forPosting('r1', posting, { now: NOW, loadSkills });
    assert(!r.qualifying.some((q) => q.candidate._id === 'hider'));
  });

  await t('invite sends only to chosen people who still qualify, records and notifies them', async () => {
    setup();
    const sent = [];
    const r = await cm.invite({ _id: 'r1' }, posting, ['c-good', 'c-hider'], { url: 'https://precheckd.com/jobs/support-engineer', now: NOW, loadSkills,
      sendMessage: async (conn, body) => { sent.push({ conn: conn._id, body }); return {}; } });
    assert.strictEqual(r.sent, 1); assert.strictEqual(r.skipped, 1);
    assert.deepStrictEqual(created, ['good']);
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].conn, 'c-good');
    assert(sent[0].body.includes('https://precheckd.com/jobs/support-engineer') && sent[0].body.includes('Support Engineer'));
    assert.strictEqual(notes.length, 1); assert.strictEqual(notes[0].type, 'job_invite'); assert.strictEqual(notes[0].url, '/jobs/support-engineer');
  });
  await t('a message that fails to send undoes the record and is not counted', async () => {
    setup();
    const r = await cm.invite({ _id: 'r1' }, posting, ['c-good'], { url: 'https://precheckd.com/jobs/x', now: NOW, loadSkills, sendMessage: async () => ({ error: 'nope' }) });
    assert.strictEqual(r.sent, 0); assert.deepStrictEqual(deleted, ['good']); assert.strictEqual(notes.length, 0);
  });
  await t('nothing chosen means nothing sent', async () => {
    setup();
    const r = await cm.invite({ _id: 'r1' }, posting, [], { url: 'https://precheckd.com/jobs/x', now: NOW, loadSkills, sendMessage: async () => ({}) });
    assert.strictEqual(r.sent, 0); assert.deepStrictEqual(created, []);
  });

  await t('each invite also emails the candidate directly, unless opted out or past the daily cap', async () => {
    setup(); counted = 0;
    const mails = [];
    const opts = { url: 'https://precheckd.com/jobs/x', now: NOW, loadSkills, sendMessage: async () => ({}), sendEmail: async (c, d) => { mails.push({ c: c._id, d }); } };
    await cm.invite({ _id: 'r1', firstName: 'Ann', lastName: 'Lee', company: 'Acme' }, posting, ['c-good'], opts);
    assert.strictEqual(mails.length, 1); assert.strictEqual(mails[0].d.recruiterName, 'Ann Lee'); assert.strictEqual(mails[0].d.company, 'Acme'); assert.strictEqual(mails[0].d.url, 'https://precheckd.com/jobs/x');
    setup(); counted = cm.MAX_EMAILS_PER_DAY; mails.length = 0;
    const r = await cm.invite({ _id: 'r1' }, posting, ['c-good'], opts);
    assert.strictEqual(r.sent, 1); assert.strictEqual(mails.length, 0); // still invited in the thread, just no email
    counted = 0;
  });
  await t('an email failure does not undo the invite', async () => {
    setup(); counted = 0;
    const r = await cm.invite({ _id: 'r1' }, posting, ['c-good'], { url: 'https://precheckd.com/jobs/x', now: NOW, loadSkills, sendMessage: async () => ({}), sendEmail: async () => { throw new Error('boom'); } });
    assert.strictEqual(r.sent, 1);
  });

  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
