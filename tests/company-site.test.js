const assert = require('assert');
const { flagNewDomain } = require('../src/services/companySite');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('FAIL', name, e.message); process.exit(1); } };
const mk = (o = {}) => ({ _id: 'p1', title: 'DevOps', hiringCompany: 'Acme', companyDomain: 'acme.com', reviewFlag: null, saved: 0, async save() { this.saved++; }, ...o });
(async () => {
  await t('a very new domain flags the posting and alerts staff, but nothing is blocked', async () => {
    const p = mk(); let sent = 0;
    assert.strictEqual(await flagNewDomain(p, { check: async () => ({ verified: false, reason: 'too_new', ageInDays: 9 }), alert: async () => { sent++; } }), true);
    assert.strictEqual(p.reviewFlag, 'new_company_domain'); assert.strictEqual(sent, 1); assert.strictEqual(p.saved, 1);
  });
  await t('an established domain, or an unknown age, sets no flag', async () => {
    const a = mk(); assert.strictEqual(await flagNewDomain(a, { check: async () => ({ verified: true, ageInDays: 4000 }) }), false);
    const b = mk(); assert.strictEqual(await flagNewDomain(b, { check: async () => ({ verified: false, reason: 'lookup_failed' }) }), false);
    assert.strictEqual(a.reviewFlag, null); assert.strictEqual(b.reviewFlag, null);
  });
  await t('an existing staff flag is never overwritten, and a posting with no domain is skipped', async () => {
    const p = mk({ reviewFlag: 'hire_denied' }); assert.strictEqual(await flagNewDomain(p, { check: async () => ({ reason: 'too_new', ageInDays: 1 }) }), false);
    assert.strictEqual(p.reviewFlag, 'hire_denied');
    assert.strictEqual(await flagNewDomain(mk({ companyDomain: '' }), { check: async () => { throw new Error('should not run'); } }), false);
  });
  console.log(`${n} tests passed`);
})();
