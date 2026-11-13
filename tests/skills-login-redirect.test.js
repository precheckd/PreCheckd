// Run: node tests/skills-login-redirect.test.js
// A logged-out visitor on an emailed Skills link goes to login and is brought back to it after logging in.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test';
const assert = require('assert');
const auth = require('../src/routes/auth');
const mk = (session, url) => { const r = { session, originalUrl: url }; const res = { redirectedTo: null, redirect(u) { this.redirectedTo = u; } }; return [r, res]; };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('logged out: remembers the Skills page and redirects to login', () => {
  const [req, res] = mk({}, '/candidate/kent-mayer/skills?finished=1'); let nexted = false;
  auth.skillsLoginRedirect(req, res, () => { nexted = true; });
  assert.strictEqual(res.redirectedTo, '/login'); assert.strictEqual(nexted, false);
  assert.strictEqual(req.session.candidateReturnTo, '/candidate/kent-mayer/skills');
});
t('logged in: passes through untouched', () => {
  const [req, res] = mk({ candidateId: 'c1' }, '/candidate/kent-mayer/skills'); let nexted = false;
  auth.skillsLoginRedirect(req, res, () => { nexted = true; });
  assert.strictEqual(nexted, true); assert.strictEqual(res.redirectedTo, null);
});
t('only a real Skills path is remembered', () => {
  assert.strictEqual(auth.safeCandidateSkillsPath('/candidate/a-b1/skills'), '/candidate/a-b1/skills');
  for (const bad of ['//evil.com/candidate/x/skills', '/candidate/x/skills/extra', 'https://evil.com', '/candidate/../admin/skills', null]) assert.strictEqual(auth.safeCandidateSkillsPath(bad), null);
});
console.log(`\n${n} passed`);
