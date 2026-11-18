// Run: node tests/finalist-views.test.js
// The pages that show finalist tests render without errors in every state, and the candidate Skills page still
// renders when a candidate has used all their test credits (it once referred to a token that only exists on staff pages).
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const views = path.join(__dirname, '..', 'views');
const render = (file, data) => ejs.renderFile(path.join(views, file), data, { views: [views] });
const ft = require('../src/content/finalistTopics');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

const skillsBase = {
  candidate: { slug: 'a-b', firstName: 'A' }, cards: [], graceDays: 0, skillCards: [], ladders: [], skillList: [], searchData: {}, titleCards: [], titles: [],
  testRequests: [], finalistInvites: [], roleTests: [], requests: [], current: [], achievementVisits: 0, finished: false, processing: false, RETAKE_DAYS: 60, notice: null, title: 't',
  credits: { enabled: true, monthlyLeft: 0, perMonth: 3, left: 0, resetsAt: new Date(), open: null, lastDecided: null, bonus: 0 },
};

const posting = { _id: 'p1', title: 'Support Engineer', hiringCompany: 'Acme' };
const person = (first) => ({ firstName: first, lastName: 'Lee' });
const app = (id, status, name) => ({ _id: id, status, candidateId: person(name), appliedAt: new Date(), roleTestStatus: 'none', connectionId: null });
const overview = (extra) => ({ slots: { used: 1, left: 4, total: 5 }, topics: [], locked: false, byApp: new Map(), hours: 72, autoReject: false, pickCount: 3, ...extra });
const appsBase = (finalist, applicants) => ({
  title: 'Applicants', posting, applicants, stages: { applied: 'Applied', rejected: 'Not moving forward' }, reasons: require('../src/content/rejectionReasons').REJECTION_REASONS,
  live: ['applied'], error: '', moved: '', queue: { waiting: 1, limit: 20 }, finalist, finalistTopics: ft.TOPICS, finalistLabel: ft.label, finalistMsg: '',
});

(async () => {
  await t('Skills page renders with zero credits (no staff-only token)', async () => {
    const html = await render('candidate-skills.ejs', skillsBase);
    assert.ok(html.includes('Request more'));
    assert.ok(!html.includes('_csrf'));
  });

  await t('Skills page shows finalist invites with Take and Decline', async () => {
    const html = await render('candidate-skills.ejs', { ...skillsBase, finalistInvites: [
      { id: 'f1', status: 'sent', expiresAt: new Date(), job: 'Support Engineer', company: 'Acme', topics: ['Logic', 'Problem solving', 'Time management'] },
      { id: 'f2', status: 'accepted', expiresAt: new Date(), job: 'Analyst', company: 'Beta', topics: ['Logic', 'Attention to detail', 'Numerical reasoning'] },
    ] });
    assert.ok(html.includes('Finalist tests') && html.includes('/skills/finalist/f1/accept') && html.includes('/skills/finalist/f1/decline'));
    assert.ok(html.includes('Continue test') && !html.includes('/skills/finalist/f2/decline'));
  });

  await t('Applicants page: no topics yet shows the 3-of-5 picker', async () => {
    const html = await render('recruiter-job-applicants.ejs', appsBase(overview(), [app('a1', 'applied', 'Pat')]));
    assert.ok(html.includes('name="finalistTopics"') && html.includes('/finalist/topics'));
    assert.ok(!html.includes('Send finalist test'));
  });

  await t('Applicants page: topics set shows slots, the OFF switch and Send buttons', async () => {
    const html = await render('recruiter-job-applicants.ejs', appsBase(overview({ topics: ['logic', 'problem', 'time'] }), [app('a1', 'applied', 'Pat')]));
    assert.ok(html.includes('1 of 5') && html.includes('Auto-reject people who do not finish') && html.includes('<strong>OFF</strong>'));
    assert.ok(html.includes('Send finalist test') && html.includes('/applicants/a1/finalist'));
  });

  await t('Applicants page: no slots left disables Send', async () => {
    const html = await render('recruiter-job-applicants.ejs', appsBase(overview({ topics: ['logic', 'problem', 'time'], slots: { used: 5, left: 0, total: 5 } }), [app('a1', 'applied', 'Pat')]));
    assert.ok(/<button class="ja-fbtn" type="submit" disabled/.test(html));
  });

  await t('Applicants page: every finalist state, and a Keep/Reject notice for someone who did not finish', async () => {
    const byApp = new Map([
      ['a1', { id: 'f1', status: 'sent', expiresAt: new Date(), score: null, topicScores: [], needsDecision: false }],
      ['a2', { id: 'f2', status: 'accepted', expiresAt: new Date(), score: null, topicScores: [], needsDecision: false }],
      ['a3', { id: 'f3', status: 'completed', expiresAt: new Date(), score: 83.4, topicScores: [{ key: 'logic', score: 90 }, { key: 'time', score: 70 }], needsDecision: false }],
      ['a4', { id: 'f4', status: 'declined', expiresAt: new Date(), score: null, topicScores: [], needsDecision: true }],
      ['a5', { id: 'f5', status: 'expired', expiresAt: new Date(), score: null, topicScores: [], needsDecision: false, decision: 'kept' }],
    ]);
    const html = await render('recruiter-job-applicants.ejs', appsBase(overview({ topics: ['logic', 'problem', 'time'], locked: true, byApp }),
      [app('a1', 'applied', 'Ann'), app('a2', 'applied', 'Bo'), app('a3', 'applied', 'Cy'), app('a4', 'applied', 'Di'), app('a5', 'applied', 'Ed')]));
    assert.ok(html.includes('83%') && html.includes('Logic 90%') && html.includes('In progress') && html.includes('Invited, they have until'));
    assert.ok(html.includes('declined</strong> the finalist test') || html.includes('declined the finalist test'));
    assert.ok(html.includes('/finalist/f4/decide') && html.includes('value="keep"') && html.includes('value="reject"'));
    assert.ok(html.includes('kept'));
    assert.ok(!html.includes('/finalist/f5/decide'));
  });

  await t('Applicants page: the finalist-only reason is not in the Move menu', async () => {
    const html = await render('recruiter-job-applicants.ejs', appsBase(overview(), [app('a1', 'applied', 'Pat')]));
    assert.ok(!html.includes('Did not complete the finalist assessment'));
  });

  console.log(`\n${n} passed`);
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(-6).join('\n')); process.exit(1); });
