const assert = require('assert');
const li = require('../src/utils/linkedin');
let fail = 0;
function t(n, f) { try { f(); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
t('accepts a normal profile', () => assert.strictEqual(li.clean('https://www.linkedin.com/in/kent-mayer-123/'), 'https://www.linkedin.com/in/kent-mayer-123'));
t('adds https and www', () => assert.strictEqual(li.clean('linkedin.com/in/kent'), 'https://www.linkedin.com/in/kent'));
t('accepts country subdomain', () => assert.strictEqual(li.clean('uk.linkedin.com/in/kent'), 'https://www.linkedin.com/in/kent'));
t('drops tracking params', () => assert.strictEqual(li.clean('https://linkedin.com/in/kent?utm=x'), 'https://www.linkedin.com/in/kent'));
t('rejects other sites', () => { assert.strictEqual(li.clean('https://evil.com/in/kent'), null); assert.strictEqual(li.clean('https://linkedin.com.evil.com/in/kent'), null); });
t('rejects company pages and blanks', () => { assert.strictEqual(li.clean('https://linkedin.com/company/x'), null); assert.strictEqual(li.clean(''), null); });
t('needs a url or the no-LinkedIn box', () => { assert(li.fromBody({}).error); assert(li.fromBody({ linkedinUrl: 'nope' }).error); });
t('no-LinkedIn box passes with no url', () => assert.deepStrictEqual(li.fromBody({ noLinkedin: 'yes', linkedinUrl: 'x' }), { url: null, none: true }));
t('good url passes', () => assert.strictEqual(li.fromBody({ linkedinUrl: 'linkedin.com/in/kent' }).url, 'https://www.linkedin.com/in/kent'));
console.log('fail=' + fail);
