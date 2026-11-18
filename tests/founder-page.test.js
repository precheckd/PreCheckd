const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
let fail = 0;
const t = (n, f) => { try { f(); console.log('ok -', n); } catch (e) { fail++; console.log('FAIL -', n, e.message); } };
const root = path.join(__dirname, '..');
t('founder view renders', () => {
  return ejs.renderFile(path.join(root, 'views/founder.ejs'), {}, (err, html) => {
    assert(!err, err && err.message);
    assert(/From the founder/.test(html) && /kent@precheckd\.com/.test(html) && /href="\/founding-recruiter"/.test(html));
  });
});
t('route registered', () => assert(/router\.get\('\/founder'/.test(fs.readFileSync(path.join(root, 'src/routes/index.js'), 'utf8'))));
t('footer links to it', () => assert(/href="\/founder"/.test(fs.readFileSync(path.join(root, 'views/layouts/main.ejs'), 'utf8'))));
console.log(fail ? 'fail=' + fail : 'fail=0'); process.exit(fail ? 1 : 0);
