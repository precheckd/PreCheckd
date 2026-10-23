// Run: node tests/job-posted-email.test.js
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test';
process.env.MOCK_EMAIL = 'true';
process.env.APP_BASE_URL = 'https://example.test';
const assert = require('assert');
const { sendJobPostedEmail, sendJobEditedEmail, sendJobClosedEmail } = require('../src/services/emailService');
const { safeRecruiterJobPath } = require('../src/routes/auth');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const id = 'a'.repeat(24);

(async () => {
  await t('the confirmation email names the job, dates, manage link and public link', async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
    try {
      await sendJobPostedEmail({ firstName: 'kent', email: 'k@acme.test' },
        { _id: id, title: 'DevOps Engineer', hiringCompany: 'Acme <Co>', closeDate: new Date('2026-11-20T17:00:00Z'), startDate: new Date('2026-12-07T12:00:00Z') },
        { publicUrl: 'https://example.test/jobs/' + id + '/devops-engineer' });
    } finally { console.log = orig; }
    const out = lines.join('\n');
    assert.match(out, /To: k@acme\.test \| Subject: Your job is live: DevOps Engineer/);
    assert.ok(out.includes(`https://example.test/recruiter-jobs/${id}`));
    assert.ok(out.includes(`https://example.test/jobs/${id}/devops-engineer`));
    assert.match(out, /Applications close: Fri, November 20, 2026/);
    assert.ok(out.includes('Acme &lt;Co&gt;'), 'company name is escaped');
  });
  await t('the edit email lists what changed and who was affected, with no candidate names', async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
    try {
      await sendJobEditedEmail({ firstName: 'kent', email: 'k@acme.test' },
        { _id: id, title: 'DevOps Engineer', hiringCompany: 'Acme', closeDate: new Date('2026-11-20T17:00:00Z'), startDate: new Date('2026-12-07T12:00:00Z') },
        { parts: ['pay', 'requirements'], withdrawn: 2, notified: 5 });
    } finally { console.log = orig; }
    const out = lines.join('\n');
    assert.match(out, /Subject: Job updated: DevOps Engineer/);
    assert.ok(out.includes('pay, requirements'));
    assert.match(out, /5 told about the update, 2 withdrawn/);
    assert.ok(out.includes(`https://example.test/recruiter-jobs/${id}`));
  });
  await t('the closing email records the outcome, reason and counts', async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
    try {
      await sendJobClosedEmail({ firstName: 'kent', email: 'k@acme.test' },
        { _id: id, title: 'DevOps Engineer', hiringCompany: 'Acme', createdAt: new Date('2026-10-23T12:00:00Z') },
        { outcomeLabel: 'The job was not filled', reasonLabel: 'Budget or headcount changed', reasonNote: '', applicants: 7, hired: 0, closedOut: 6 });
    } finally { console.log = orig; }
    const out = lines.join('\n');
    assert.match(out, /Subject: Job closed: DevOps Engineer/);
    assert.ok(out.includes('The job was not filled') && out.includes('Budget or headcount changed'));
    assert.match(out, /Applicants: 7, told the position closed: 6/);
  });
  await t('only a recruiter\'s own posting pages are remembered for after login', () => {
    assert.strictEqual(safeRecruiterJobPath(`/recruiter-jobs/${id}`), `/recruiter-jobs/${id}`);
    assert.strictEqual(safeRecruiterJobPath(`/recruiter-jobs/${id}/edit`), `/recruiter-jobs/${id}/edit`);
    assert.strictEqual(safeRecruiterJobPath('https://evil.test/'), null);
    assert.strictEqual(safeRecruiterJobPath('//evil.test'), null);
    assert.strictEqual(safeRecruiterJobPath(`/recruiter-jobs/${id}/../../admin`), null);
    assert.strictEqual(safeRecruiterJobPath('/recruiter-jobs/new'), null);
  });
  console.log(`\n${n} tests passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
