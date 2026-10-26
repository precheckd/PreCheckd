// Run: node tests/profile-screens.test.js
// Renders the screens changed in Job Board step 2 with sample data, and checks the education merge
// rules (a changed level must reset verification).
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test'; // route files load the email service
require('../src/utils/levelName');
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');

const Candidate = require('../src/models/Candidate');
const { mergeEducation, educationForForm } = require('../src/routes/candidate-edit')._internals;
const { SHIFT_OPTIONS, candidateShiftGroup } = require('../src/utils/availabilityMatching');
const { CLEARANCE_OPTIONS, candidateClearanceGroup } = require('../src/utils/clearanceMatching');
const { LEVELS } = require('../src/utils/educationLevel');
const { CATALOG } = require('../src/content/certCatalog');

const views = path.join(__dirname, '..', 'views');
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

function sampleCandidate(extra = {}) {
  return new Candidate({
    firstName: 'Kent', lastName: 'Mayer', slug: 'kent-mayer', email: 'k@example.com', phone: '+15555550100',
    educationHistory: [
      { schoolName: 'WGU', degree: 'BS Computer Science', graduationDate: '2027-05', verified: true },
      { schoolName: 'State U', degree: 'Associate of Arts', graduationDate: '2010-05', level: 'associate', verified: false },
    ],
    certifications: [{ name: 'Security+', verified: true }],
    shifts: ['daytime', 'evenings'], availableFrom: new Date('2026-12-01T00:00:00Z'),
    securityClearance: 'secret', showClearanceInSearch: true,
    ...extra,
  });
}

(async () => {
  // ---- screens render ----
  await t('Job Preferences renders shifts, start date and clearance opt-in', async () => {
    const html = await ejs.renderFile(path.join(views, 'candidate-job-preferences.ejs'), {
      candidate: sampleCandidate(), title: 't', error: null, missingRequirements: [], shiftOptions: SHIFT_OPTIONS,
    });
    assert.ok(html.includes('name="shifts" value="daytime" checked'));
    assert.ok(html.includes('name="shifts" value="overnight" >') || html.includes('name="shifts" value="overnight"'));
    assert.ok(!/name="shifts" value="overnight"[^>]*checked/.test(html));
    assert.ok(html.includes('name="availableFrom" value="2026-12-01"'));
    assert.ok(/name="showClearanceInSearch"[^>]*checked/.test(html));
    assert.ok(!html.includes('name="availableDays"'));
  });

  await t('Job Preferences renders for a brand-new candidate (nothing set)', async () => {
    const html = await ejs.renderFile(path.join(views, 'candidate-job-preferences.ejs'), {
      candidate: new Candidate({ firstName: 'A', lastName: 'B', slug: 'a-b', email: 'a@b.co', phone: '+15555550101' }),
      title: 't', error: null, missingRequirements: [], shiftOptions: SHIFT_OPTIONS,
    });
    assert.ok(html.includes('name="availableFrom" value=""'));
    assert.ok(!/name="showClearanceInSearch"[^>]*checked/.test(html));
  });

  await t('Recruiter search form renders the shift and clearance filters', async () => {
    const html = await ejs.renderFile(path.join(views, 'candidate-search.ejs'), {
      candidates: [], hasSearched: false, keyword: '', pinnedLat: null, pinnedLng: null, pinnedLabel: '',
      budgetAmount: null, budgetType: 'annual', workArrangement: null,
      shiftOptions: SHIFT_OPTIONS, requiredShift: 'evenings', clearanceOptions: CLEARANCE_OPTIONS, requiredClearance: 'secret',
      skillOptions: [], titleOptions: [], titleFilter: null, requirements: [], levels: ['Foundational', 'Intermediate', 'Advanced', 'Expert'],
      title: 't',
    });
    assert.ok(/<option value="evenings" selected>/.test(html));
    assert.ok(/<option value="secret" selected>/.test(html));
    assert.ok(!html.includes('value="flexible"'));
    assert.ok(!html.includes('filter-avail'));
  });

  await t('Admin verify screen shows the education level', async () => {
    const cand = sampleCandidate();
    assert.strictEqual(cand.educationHistory[0].levelLabel, "Bachelor's degree (guessed from the degree text)");
    assert.strictEqual(cand.educationHistory[1].levelLabel, 'Associate degree');
    assert.strictEqual(new Candidate({ ...cand.toObject(), educationHistory: [{ schoolName: 'x', degree: 'Odd', graduationDate: '2020-01' }] }).educationHistory[0].levelLabel, 'Not set');
  });

  // ---- education merge rules ----
  const saved = [
    { schoolName: 'WGU', degree: 'BS Computer Science', graduationDate: '2027-05', verified: true, verifiedAt: new Date('2026-10-01') },
  ];
  const form = (over = {}) => ({ schoolName: 'WGU', degree: 'BS Computer Science', graduationDate: '2027-05', level: 'bachelor', ...over });

  await t('form pre-fills a guessed level for an older entry', async () => {
    const c = sampleCandidate();
    assert.strictEqual(educationForForm(c)[0].level, 'bachelor');
    assert.strictEqual(educationForForm(c)[1].level, 'associate');
  });
  await t('confirming the guessed level keeps the entry verified and stores the level', async () => {
    const [e] = mergeEducation([form()], saved);
    assert.strictEqual(e.verified, true);
    assert.strictEqual(e.level, 'bachelor');
  });
  await t('picking a different level makes a new, unverified entry', async () => {
    const [e] = mergeEducation([form({ level: 'doctorate' })], saved);
    assert.strictEqual(e.verified, false);
    assert.strictEqual(e.verifiedAt, null);
    assert.strictEqual(e.level, 'doctorate');
  });
  await t('an unknown level value is ignored, not trusted', async () => {
    const [e] = mergeEducation([form({ level: 'astronaut' })], saved);
    assert.strictEqual(e.level, null);
    assert.strictEqual(e.verified, false); // differs from the guessed level, so it is a new entry
  });
  await t('a new entry starts unverified; blank required fields are dropped', async () => {
    const out = mergeEducation([form({ schoolName: 'MIT', degree: 'MS AI', level: 'master' }), form({ schoolName: '' })], saved);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].verified, false);
    assert.strictEqual(out[0].level, 'master');
  });
  await t('an entry with no guessable degree and no level keeps its verification when left blank', async () => {
    const odd = [{ schoolName: 'X', degree: 'Studies', graduationDate: '2020-01', verified: true }];
    const [e] = mergeEducation([{ schoolName: 'X', degree: 'Studies', graduationDate: '2020-01', level: '' }], odd);
    assert.strictEqual(e.verified, true);
    assert.strictEqual(e.level, null);
  });

  // ---- shift and clearance groups ----
  await t('shift groups', async () => {
    assert.strictEqual(candidateShiftGroup({ shifts: ['daytime'] }, 'daytime'), 'matched');
    assert.strictEqual(candidateShiftGroup({ shifts: ['flexible'] }, 'overnight'), 'matched');
    assert.strictEqual(candidateShiftGroup({ shifts: ['daytime'] }, 'overnight'), 'excluded');
    assert.strictEqual(candidateShiftGroup({ shifts: [] }, 'overnight'), 'unset');
    assert.strictEqual(candidateShiftGroup({}, 'overnight'), 'unset');
    assert.strictEqual(candidateShiftGroup({ shifts: ['daytime'] }, ''), 'matched');
  });
  await t('clearance groups: only opted-in values are searchable', async () => {
    const c = (clr, show) => ({ securityClearance: clr, showClearanceInSearch: show });
    assert.strictEqual(candidateClearanceGroup(c('ts_sci', true), 'secret'), 'matched');
    assert.strictEqual(candidateClearanceGroup(c('secret', true), 'secret'), 'matched');
    assert.strictEqual(candidateClearanceGroup(c('public_trust', true), 'secret'), 'excluded');
    assert.strictEqual(candidateClearanceGroup(c('none', true), 'public_trust'), 'excluded');
    assert.strictEqual(candidateClearanceGroup(c('ts_sci', false), 'secret'), 'unset');
    assert.strictEqual(candidateClearanceGroup(c('none', false), ''), 'matched');
  });

  assert.ok(LEVELS.length === 5 && CATALOG.length > 30);
  console.log(`\n${n} tests passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
