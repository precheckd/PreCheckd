// Run: node tests/posting-suggest.test.js
// Skill/title suggestions from a job description: only our own skills, never levels, AI optional, capped per day.
const assert = require('assert');
delete process.env.ANTHROPIC_API_KEY;
const ps = require('../src/services/postingSuggest');
const options = [{ key: 'azure', label: 'Azure' }, { key: 'aws', label: 'AWS' }, { key: 'linux', label: 'Linux' }, { key: 'networking', label: 'Networking' }];
const text = 'We need an infrastructure engineer to run Azure and AWS workloads, Azure migrations, and Linux hosts every day. Azure expertise is a must.';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

(async () => {
  await t('keyword fallback finds named skills, most mentioned first, only ours', async () => {
    const out = ps.keywordSkills(text, options);
    assert.deepStrictEqual(out.map((x) => x.key), ['azure', 'aws', 'linux']);
  });
  await t('word boundaries: "AWS" is not found inside another word', async () => {
    assert.deepStrictEqual(ps.keywordSkills('The lawsuits were lawful', options), []);
  });
  await t('parse keeps only allowed keys, dedupes, trims titles, drops junk', async () => {
    const out = ps.parse('```json\n{"skills":["azure","terraform","azure","aws"],"roles":["devops-aws","made-up","devops-aws"],"missing":["Terraform"]}\n```', options);
    assert.deepStrictEqual(out.skills.map((x) => x.key), ['azure', 'aws']);
    assert.deepStrictEqual(out.roles, [{ id: 'devops-aws', title: 'DevOps (AWS)' }]); assert.deepStrictEqual(out.missing, ['Terraform']);
    assert.strictEqual(ps.parse('not json', options), null);
  });
  await t('no API key: falls back to keywords; short text is refused', async () => {
    const out = await ps.suggest({ summary: text, responsibilities: '' }, options, { recruiterId: 'r1' });
    assert.strictEqual(out.source, 'keywords'); assert.ok(out.skills.length);
    assert.strictEqual((await ps.suggest({ summary: 'tiny', responsibilities: '' }, options, { recruiterId: 'r1' })).error, 'short');
  });
  await t('AI answer is used; an unknown skill the AI invents is dropped', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"skills":["azure","kubernetes"],"roles":["devops-aws"],"missing":["Kubernetes"]}' }] }) });
    const out = await ps.suggest({ summary: text, responsibilities: '' }, options, { recruiterId: 'r2', fetchImpl });
    assert.strictEqual(out.source, 'ai'); assert.deepStrictEqual(out.skills.map((x) => x.key), ['azure']); assert.deepStrictEqual(out.roles.map((r) => r.id), ['devops-aws']);
  });
  await t('an AI failure falls back to keywords', async () => {
    const out = await ps.suggest({ summary: text, responsibilities: '' }, options, { recruiterId: 'r3', fetchImpl: async () => { throw new Error('down'); } });
    assert.strictEqual(out.source, 'keywords'); delete process.env.ANTHROPIC_API_KEY;
  });
  await t('daily limit per recruiter', async () => {
    let last;
    for (let i = 0; i < 40; i++) last = await ps.suggest({ summary: text, responsibilities: '' }, options, { recruiterId: 'r9' });
    assert.strictEqual(last.error, 'limit');
  });
  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
