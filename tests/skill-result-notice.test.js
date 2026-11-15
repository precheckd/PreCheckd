// Run: node tests/skill-result-notice.test.js
// "Your results are ready" is not sent for job (role), finalist or custom tests, because candidates are not shown those results.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
process.env.MOCK_EMAIL = 'true';
const assert = require('assert');
const Candidate = require('../src/models/Candidate');
const SkillAssessment = require('../src/models/SkillAssessment');
const Notification = require('../src/models/Notification');
const emailService = require('../src/services/emailService');
const sk = require('../src/services/skillNotifications');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }
const sent = []; Notification.create = async (d) => { sent.push(d); return d; };
emailService.sendSkillNoticeEmail = async () => {};
Candidate.findById = async () => ({ _id: 'c1', slug: 'a-b', email: 'a@b.com', firstName: 'A' });
require('../src/services/updates').sweepCandidateLater = () => {};
require('../src/services/testRequests').onResult = async () => {};
require('../src/services/roleTests').onResult = async () => {};

const run = async (assessment) => {
  sent.length = 0;
  SkillAssessment.findOne = async () => assessment;
  const result = { candidateId: 'c1', assessmentId: 'a1', status: 'completed', resultNotified: false, held: false, skills: [], save: async function () {} };
  await sk.resultsLanded(result);
  return sent.map((x) => x.type);
};

(async () => {
  await t('a skill test still gets "results ready"', async () => assert.deepStrictEqual(await run({ name: 'Azure', kind: 'skill', tier: null, skills: [] }), ['skill_result']));
  await t('a job (role) test does not', async () => assert.deepStrictEqual(await run({ name: 'Azure DevOps', kind: 'title', roleKey: 'azure-devops', skills: [] }), []));
  await t('finalist and custom tests do not', async () => {
    assert.deepStrictEqual(await run({ name: 'F', kind: 'finalist', skills: [] }), []);
    assert.deepStrictEqual(await run({ name: 'C', kind: 'custom', skills: [] }), []);
  });
  await t('a recruiter-requested job title test (no role) still does, since candidates see that score', async () =>
    assert.deepStrictEqual(await run({ name: 'Cloud Engineer', kind: 'title', roleKey: null, skills: [] }), ['skill_result']));
  console.log(`\n${n} passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
