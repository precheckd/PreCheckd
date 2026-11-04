// Run: node tests/setup-reminders.test.js
// Setup reminder emails: which stage is due, the send window, and the email itself (MOCK_EMAIL, nothing is sent).
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.MOCK_EMAIL = 'true';
process.env.APP_BASE_URL = 'https://example.test';
process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || 'test-secret';
const assert = require('assert');
const Candidate = require('../src/models/Candidate');
const { dueStages, runSetupReminders } = require('../src/services/setupReminders');
const { setupProgress } = require('../src/utils/candidateOnboarding');
const { sendSetupReminderEmail } = require('../src/services/emailService');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-10T15:00:00Z'); // 10:00 ET
const make = (ageDays, sent = []) => new Candidate({
  firstName: 'Kent', lastName: 'Mayer', slug: 'kent-mayer', email: 'k@example.com', phone: '+15555550100',
  onboarding: { required: true, remindersSent: sent }, createdAt: new Date(NOW.getTime() - ageDays * DAY)
});

(async () => {
  await t('nothing is due before day 1', () => assert.deepStrictEqual(dueStages(make(0.5), NOW), []));
  await t('day 1, 3 and 7 come due in order', () => {
    assert.deepStrictEqual(dueStages(make(1.2), NOW).map((s) => s.key), ['d1']);
    assert.deepStrictEqual(dueStages(make(3.1, ['d1']), NOW).map((s) => s.key), ['d3']);
    assert.deepStrictEqual(dueStages(make(7.5, ['d1', 'd3']), NOW).map((s) => s.key), ['d7']);
  });
  await t('a missed stage is folded into the latest one (one email, not two)', () => {
    assert.deepStrictEqual(dueStages(make(4), NOW).map((s) => s.key), ['d1', 'd3']);
  });
  await t('nothing is due once all three were sent', () => {
    assert.deepStrictEqual(dueStages(make(20, ['d1', 'd3', 'd7']), NOW), []);
  });
  await t('outside 9:00-19:59 ET nothing runs (no database needed)', async () => {
    const night = new Date('2026-11-10T07:00:00Z'); // 2:00 ET
    assert.strictEqual((await runSetupReminders({ now: night })).outsideWindow, true);
  });
  await t('the email lists only remaining steps and links to setup', async () => {
    const c = make(1.2);
    const remaining = setupProgress(c).steps.filter((s) => !s.done);
    const logs = [];
    const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
    try { await sendSetupReminderEmail(c, { stage: 'd1', remaining, total: 4 }); } finally { console.log = orig; }
    const out = logs.join('\n');
    assert(out.includes('Subject: Finish setting up your PreCheckd profile'));
    assert(out.includes('4 of 4 steps left') && out.includes('/candidate/kent-mayer/setup') && out.includes('Unsubscribe'));
    assert(out.includes('Where you&#39;ll work') || out.includes("Where you'll work") || out.includes('Where you'));
  });
  await t('the last reminder says so', async () => {
    const c = make(7.5);
    const logs = [];
    const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
    try { await sendSetupReminderEmail(c, { stage: 'd7', remaining: setupProgress(c).steps, total: 4 }); } finally { console.log = orig; }
    assert(logs.join('\n').includes('Last reminder'));
  });
  console.log(`\n${n} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
