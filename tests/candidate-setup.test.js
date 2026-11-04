// Run: node tests/candidate-setup.test.js
// Guided candidate setup: step status comes from real profile data, the redirect stops once every
// required step is done, existing accounts are never gated, and the setup screens render.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const Candidate = require('../src/models/Candidate');
const { setupProgress, isOnboardingPending } = require('../src/utils/candidateOnboarding');

const views = path.join(__dirname, '..', 'views');
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

const base = { firstName: 'Kent', lastName: 'Mayer', slug: 'kent-mayer', email: 'k@example.com', phone: '+15555550100' };
const polygon = { type: 'MultiPolygon', coordinates: [[[[0, 0], [0, 1], [1, 1], [0, 0]]]] };

(async () => {
  await t('a brand-new account has no steps done and is pending', () => {
    const c = new Candidate({ ...base, onboarding: { required: true } });
    const p = setupProgress(c);
    assert.strictEqual(p.done, 0);
    assert.strictEqual(p.total, 4);
    assert.strictEqual(isOnboardingPending(c), true);
  });

  await t('existing accounts (required not set) are never pending', () => {
    assert.strictEqual(isOnboardingPending(new Candidate(base)), false);
  });

  await t('each step reads real data', () => {
    const c = new Candidate({
      ...base, onboarding: { required: true },
      workAreas: polygon, minSalaryAmount: 90000, minSalaryType: 'annual', workArrangement: ['remote'],
      resumeUrl: 'https://example.com/r.pdf'
    });
    const done = Object.fromEntries(setupProgress(c).steps.map((s) => [s.key, s.done]));
    assert.deepStrictEqual(done, { workAreas: true, preferences: true, background: true, sharing: false });
  });

  await t('salary without arrangement leaves the pay step open', () => {
    const c = new Candidate({ ...base, minSalaryAmount: 90000, minSalaryType: 'annual' });
    assert.strictEqual(setupProgress(c).steps.find((s) => s.key === 'preferences').done, false);
  });

  await t('work history or Credly also counts as background', () => {
    const a = new Candidate({ ...base, credlyUsername: 'kent' });
    const b = new Candidate({ ...base, workHistory: [{ employerName: 'X', jobTitle: 'Y' }] });
    assert.strictEqual(setupProgress(a).steps[2].done, true);
    assert.strictEqual(setupProgress(b).steps[2].done, true);
  });

  await t('confirming sharing completes the setup; completedAt stops the redirect', () => {
    const c = new Candidate({
      ...base, onboarding: { required: true, sharingConfirmedAt: new Date() },
      workAreas: polygon, minSalaryAmount: 90000, minSalaryType: 'annual', workArrangement: ['hybrid'], credlyUsername: 'k'
    });
    assert.strictEqual(setupProgress(c).complete, true);
    c.onboarding.completedAt = new Date();
    assert.strictEqual(isOnboardingPending(c), false);
  });

  await t('setup page renders in-progress and complete states', async () => {
    const mid = new Candidate({ ...base, onboarding: { required: true }, workAreas: polygon });
    const html1 = await ejs.renderFile(path.join(views, 'candidate-setup.ejs'), { candidate: mid, progress: setupProgress(mid), identityDone: false });
    assert(html1.includes('Set up your profile') && html1.includes('Verify now') && html1.includes('Pay and work style'));
    assert(!html1.includes('Confirm</button>'), 'sharing form only appears after earlier steps');

    const full = new Candidate({
      ...base, onboarding: { required: true, sharingConfirmedAt: new Date() },
      workAreas: polygon, minSalaryAmount: 1, minSalaryType: 'annual', workArrangement: ['remote'], credlyUsername: 'k', isIdentityVerified: true
    });
    const html2 = await ejs.renderFile(path.join(views, 'candidate-setup.ejs'), { candidate: full, progress: setupProgress(full), identityDone: true });
    assert(html2.includes("You're all set") && html2.includes('Take your first skill tests') && !html2.includes('Verify now'));

    const last = new Candidate({
      ...base, onboarding: { required: true },
      workAreas: polygon, minSalaryAmount: 1, minSalaryType: 'annual', workArrangement: ['remote'], credlyUsername: 'k'
    });
    const html3 = await ejs.renderFile(path.join(views, 'candidate-setup.ejs'), { candidate: last, progress: setupProgress(last), identityDone: true });
    assert(html3.includes('Confirm</button>'), 'sharing form shows when it is the next step');
  });

  await t('back-to-setup banner shows only while setup is pending', async () => {
    const pending = new Candidate({ ...base, onboarding: { required: true } });
    const finished = new Candidate({ ...base, onboarding: { required: true, completedAt: new Date() } });
    const f = path.join(views, 'partials', 'setup-back.ejs');
    assert((await ejs.renderFile(f, { candidate: pending })).includes('Back to setup'));
    assert(!(await ejs.renderFile(f, { candidate: finished })).includes('Back to setup'));
    assert(!(await ejs.renderFile(f, { candidate: new Candidate(base) })).includes('Back to setup'));
  });

  console.log(`\n${n} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
