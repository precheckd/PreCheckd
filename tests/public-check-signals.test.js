// Public recruiter checker extras: plain-English age, look-alike names, and the free DNS checks.
const assert = require('assert');
const lookalike = require('../src/services/lookalike');
const domainDns = require('../src/services/domainDns');
const publicCheck = require('../src/services/publicCheck');
let fail = 0;
const t = async (n, f) => { try { await f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

(async () => {
  await t('age wording', () => {
    assert.strictEqual(publicCheck.ageText(1), '1 day');
    assert.strictEqual(publicCheck.ageText(5), '5 days');
    assert.strictEqual(publicCheck.ageText(21), 'about 3 weeks');
    assert.strictEqual(publicCheck.ageText(250), 'about 8 months');
    assert.strictEqual(publicCheck.ageText(1200), 'about 3 years');
    assert.strictEqual(publicCheck.ageBand(10), 'very_new');
    assert.strictEqual(publicCheck.ageBand(90), 'recent');
    assert.strictEqual(publicCheck.ageBand(400), 'established');
  });

  await t('real names and unrelated domains are not flagged', () => {
    ['amazon.com', 'careers.amazon.co.uk', 'microsoft.com', 'acme.com', 'hrsolutions.com', 'metacareers.com', 'teksystems.com', 'citizens.com', 'metaverse.com'].forEach((d) => assert.strictEqual(lookalike.check(d), null, d));
  });
  await t('name plus extra words is flagged', () => {
    assert.deepStrictEqual(lookalike.check('microsoft-hiring.net'), { kind: 'uses_name', brand: 'Microsoft' });
    assert.deepStrictEqual(lookalike.check('amaz0n-careers.com'), { kind: 'uses_name', brand: 'Amazon' });
    assert.deepStrictEqual(lookalike.check('tesla-careers.com'), { kind: 'uses_name', brand: 'Tesla' });
  });
  await t('near-miss spellings are flagged', () => {
    assert.deepStrictEqual(lookalike.check('rnicrosoft.com'), { kind: 'lookalike', brand: 'Microsoft' });
    assert.deepStrictEqual(lookalike.check('goggle.com'), { kind: 'lookalike', brand: 'Google' });
    assert.deepStrictEqual(lookalike.check('delloite.com'), { kind: 'lookalike', brand: 'Deloitte' });
  });

  await t('dns: records found', async () => {
    const r = { resolveMx: async () => [{ exchange: 'm', priority: 1 }], resolve4: async () => ['1.2.3.4'], resolve6: async () => { throw Object.assign(new Error('x'), { code: 'ENODATA' }); } };
    assert.deepStrictEqual(await domainDns.check('a.com', r), { mail: 'yes', web: 'yes' });
  });
  await t('dns: clearly missing is "no"', async () => {
    const none = async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); };
    assert.deepStrictEqual(await domainDns.check('a.com', { resolveMx: none, resolve4: none, resolve6: none }), { mail: 'no', web: 'no' });
  });
  await t('dns: errors and timeouts are "unknown", never "no"', async () => {
    const boom = async () => { throw Object.assign(new Error('x'), { code: 'ESERVFAIL' }); };
    assert.deepStrictEqual(await domainDns.check('a.com', { resolveMx: boom, resolve4: boom, resolve6: boom }), { mail: 'unknown', web: 'unknown' });
  });

  console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
})();
