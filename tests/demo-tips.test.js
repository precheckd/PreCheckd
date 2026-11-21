// Demo tips: the script loads only inside the demo banner block, parses, and its text quotes no prices.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let fail = 0;
const t = (n, f) => { try { f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };

const layout = fs.readFileSync(path.join(__dirname, '..', 'views', 'layouts', 'main.ejs'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'demo-tips.js'), 'utf8');

t('the script tag is inside the demoMode block only', () => {
  assert.strictEqual((layout.match(/demo-tips\.js/g) || []).length, 1);
  const start = layout.indexOf("typeof demoMode !== 'undefined' && demoMode) { %>");
  const end = layout.indexOf('<% } %>', start);
  const at = layout.indexOf('demo-tips.js');
  assert(start > -1 && at > start && at < end);
});
t('the script is valid JavaScript', () => { new vm.Script(js); });
t('tips quote no prices', () => { assert(!/\$\d/.test(js)); });
t('tips can be switched off with ?tips=0', () => { assert(/tips/.test(js) && /'0'/.test(js)); });

console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
