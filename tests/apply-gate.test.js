// Run with: node tests/apply-gate.test.js
const assert = require('assert');
const g = require('../src/services/applyGate');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL:', name, '\n  ', e.message); process.exitCode = 1; } }

const NOW = new Date('2026-10-22T12:00:00Z').getTime();
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY);
const ahead = (days) => new Date(NOW + days * DAY);

// A candidate who meets everything unless a test says otherwise.
function cand(over = {}) {
  return {
    verified: { email: true, phone: true, identity: true },
    skills: [{ key: 'linux', label: 'Linux', level: 'Intermediate', takenAt: ago(30) }],
    education: { verifiedLevel: 3, pendingLevel: 3 },
    certs: [{ catalogId: 'secplus', label: 'Security+', verified: true, expiresAt: ahead(200) }],
    clearance: 3,
    shifts: ['daytime'],
    availableFrom: ago(5),
    areaMatch: true,
    alreadyApplied: false, blockedByRecruiter: false,
    ...over
  };
}
function post(over = {}) {
  return {
    status: 'open', closeDate: ahead(20),
    skills: [{ key: 'linux', label: 'Linux', minLevel: 'Intermediate' }],
    education: 3,
    certGroups: [[{ catalogId: 'secplus', label: 'Security+' }, { catalogId: 'cissp', label: 'CISSP' }]],
    clearance: 2,
    shift: 'daytime', arrangement: 'onsite', startDate: ahead(30), startFirm: false,
    ...over
  };
}
const ev = (c, p) => g.evaluate(c, p, NOW);
const codes = (r) => r.blockers.map((b) => b.code);

t('a candidate who meets everything can apply', () => {
  const r = ev(cand(), post());
  assert.strictEqual(r.canApply, true); assert.deepStrictEqual(r.blockers, []);
});

t('closed by status or by close date, nothing else is reported', () => {
  assert.deepStrictEqual(codes(ev(cand(), post({ status: 'closed' }))), ['posting_closed']);
  const r = ev(cand({ skills: [] }), post({ closeDate: ago(1) }));
  assert.strictEqual(r.closed, true); assert.deepStrictEqual(codes(r), ['posting_closed']);
  assert.strictEqual(r.blockers[0].message, 'This position is closed.');
});

t('account blockers: unverified, already applied, blocked by recruiter, membership', () => {
  assert.deepStrictEqual(codes(ev(cand({ verified: { email: true, phone: false, identity: true } }), post())), ['not_verified']);
  assert.deepStrictEqual(codes(ev(cand({ alreadyApplied: true }), post())), ['already_applied']);
  assert.deepStrictEqual(codes(ev(cand({ blockedByRecruiter: true }), post())), ['recruiter_block']);
  assert.deepStrictEqual(codes(ev(cand({ membershipActive: false }), post())), ['membership_inactive']);
  assert.strictEqual(ev(cand({ membershipActive: undefined }), post()).canApply, true); // billing not built: not checked
  assert.strictEqual(ev(cand({ membershipActive: true }), post()).canApply, true);
});

t('skill missing offers the track, with the exact wording from the spec', () => {
  const r = ev(cand({ skills: [] }), post());
  assert.deepStrictEqual(codes(r), ['skill_missing']);
  assert.strictEqual(r.blockers[0].message,
    'This job requires an Intermediate skill score for Linux which you do not currently possess. Would you like this skill certification track sent to you?');
  assert.deepStrictEqual(r.blockers[0].actions, [{ kind: 'start_track', skillKey: 'linux' }, { kind: 'withdraw' }]);
});

t('skill below the minimum names the current level', () => {
  const r = ev(cand({ skills: [{ key: 'linux', level: 'Foundational', takenAt: ago(10) }] }), post());
  assert.deepStrictEqual(codes(r), ['skill_below']);
  assert.ok(r.blockers[0].message.includes('Your current level is Foundational.'));
});

t('a higher level satisfies a lower requirement; Developing never does', () => {
  assert.strictEqual(ev(cand({ skills: [{ key: 'linux', level: 'Expert', takenAt: ago(10) }] }), post()).canApply, true);
  assert.deepStrictEqual(codes(ev(cand({ skills: [{ key: 'linux', level: 'Developing', takenAt: ago(10) }] }), post())), ['skill_below']);
});

t('a hidden skill still counts: the engine only sees real levels', () => {
  // the adapter passes every published skill; nothing here depends on visibility
  assert.strictEqual(ev(cand(), post()).canApply, true);
});

t('stale result (over 12 months) needs a retake', () => {
  const r = ev(cand({ skills: [{ key: 'linux', level: 'Advanced', takenAt: ago(400) }] }), post());
  assert.deepStrictEqual(codes(r), ['skill_stale']);
  assert.ok(r.blockers[0].message.includes('more than 12 months old'));
});

t('retake lock shows the retake date instead of the track offer', () => {
  const r = ev(cand({ skills: [{ key: 'linux', level: 'Foundational', takenAt: ago(20), nextAttemptAt: ahead(40) }] }), post());
  assert.deepStrictEqual(codes(r), ['skill_locked']);
  assert.ok(/You can retake the test on [A-Z][a-z]+ \d+, \d{4}\./.test(r.blockers[0].message));
  assert.deepStrictEqual(r.blockers[0].actions, [{ kind: 'withdraw' }]);
  // a stale result that is also locked says so
  const s = ev(cand({ skills: [{ key: 'linux', level: 'Advanced', takenAt: ago(400), nextAttemptAt: ahead(5) }] }), post());
  assert.deepStrictEqual(codes(s), ['skill_locked']);
});

t('a result under integrity review says being reviewed, no reason', () => {
  const r = ev(cand({ skills: [{ key: 'linux', level: 'Foundational', takenAt: ago(5), reviewing: true }] }), post());
  assert.deepStrictEqual(codes(r), ['skill_reviewing']);
  assert.ok(!/cheat|integrity|ai/i.test(r.blockers[0].message));
});

t('entry level: no minimum means no skill blocker, even with no skills', () => {
  const p = post({ skills: [{ key: 'linux', label: 'Linux', minLevel: null }], education: null, certGroups: [], clearance: null });
  assert.strictEqual(g.isEntryLevel(p), true);
  assert.strictEqual(ev(cand({ skills: [], education: {}, certs: [], clearance: null }), p).canApply, true);
  assert.strictEqual(g.isEntryLevel(post()), false);
});

t('three skills: every one is checked, one message each', () => {
  const p = post({ skills: [
    { key: 'linux', label: 'Linux', minLevel: 'Intermediate' },
    { key: 'agile', label: 'Agile', minLevel: 'Foundational' },
    { key: 'aws', label: 'AWS', minLevel: 'Advanced' }] });
  const r = ev(cand({ skills: [{ key: 'linux', level: 'Intermediate', takenAt: ago(1) }] }), p);
  assert.deepStrictEqual(codes(r), ['skill_missing', 'skill_missing']);
  assert.deepStrictEqual(r.blockers.map((b) => b.skillKey), ['agile', 'aws']);
});

t('education: verified level gates; a higher level satisfies a lower one', () => {
  assert.strictEqual(ev(cand({ education: { verifiedLevel: 5, pendingLevel: 5 } }), post()).canApply, true);
  const r = ev(cand({ education: { verifiedLevel: 2, pendingLevel: 2 } }), post());
  assert.deepStrictEqual(codes(r), ['education_missing']);
  assert.ok(r.blockers[0].message.includes("Bachelor's degree or higher"));
});

t('education reported but not yet verified says it is being verified', () => {
  const r = ev(cand({ education: { verifiedLevel: 0, pendingLevel: 3 } }), post());
  assert.deepStrictEqual(codes(r), ['education_pending']);
  assert.ok(r.blockers[0].message.includes('being verified'));
  assert.deepStrictEqual(r.blockers[0].actions, [{ kind: 'withdraw' }]);
});

t('certification groups: OR inside a group, AND across groups', () => {
  assert.strictEqual(ev(cand({ certs: [{ catalogId: 'cissp', verified: true, expiresAt: null }] }), post()).canApply, true);
  const two = post({ certGroups: [
    [{ catalogId: 'secplus', label: 'Security+' }, { catalogId: 'cissp', label: 'CISSP' }],
    [{ catalogId: 'awsccp', label: 'AWS Cloud Practitioner' }]] });
  const r = ev(cand(), two);
  assert.deepStrictEqual(codes(r), ['cert_missing']);
  assert.strictEqual(r.blockers[0].group, 1);
  assert.strictEqual(r.blockers[0].message, 'This job requires AWS Cloud Practitioner. You do not have it verified. Add it to your profile, or withdraw.');
  assert.strictEqual(ev(cand({ certs: [
    { catalogId: 'secplus', verified: true }, { catalogId: 'awsccp', verified: true }] }), two).canApply, true);
});

t('certification missing lists every option', () => {
  const r = ev(cand({ certs: [] }), post());
  assert.strictEqual(r.blockers[0].message,
    'This job requires one of: Security+ or CISSP. You do not have any of these verified. Add one to your profile, or withdraw.');
});

t('certification: no automatic equivalence, unverified and expired have their own messages', () => {
  assert.deepStrictEqual(codes(ev(cand({ certs: [{ catalogId: 'ceh', verified: true }] }), post())), ['cert_missing']);
  const u = ev(cand({ certs: [{ catalogId: 'secplus', verified: false }] }), post());
  assert.deepStrictEqual(codes(u), ['cert_unverified']);
  assert.ok(u.blockers[0].message.includes('Security+ is not verified yet'));
  const e = ev(cand({ certs: [{ catalogId: 'secplus', verified: true, expiresAt: new Date('2026-09-01T00:00:00Z') }] }), post());
  assert.deepStrictEqual(codes(e), ['cert_expired']);
  assert.ok(e.blockers[0].message.includes('Your Security+ expired on September 1, 2026.'));
});

t('a cert is valid through the end of its expiry day', () => {
  const today = new Date('2026-10-22T00:00:00Z');
  assert.strictEqual(ev(cand({ certs: [{ catalogId: 'secplus', verified: true, expiresAt: today }] }), post()).canApply, true);
  const yesterday = new Date('2026-10-21T00:00:00Z');
  assert.deepStrictEqual(codes(ev(cand({ certs: [{ catalogId: 'secplus', verified: true, expiresAt: yesterday }] }), post())), ['cert_expired']);
});

t('an expired cert does not block when another cert in the group is valid', () => {
  const certs = [{ catalogId: 'secplus', verified: true, expiresAt: ago(30) }, { catalogId: 'cissp', verified: true }];
  assert.strictEqual(ev(cand({ certs }), post()).canApply, true);
});

t('clearance: reported level gates, higher satisfies lower, never says verified', () => {
  assert.strictEqual(ev(cand({ clearance: 4 }), post({ clearance: 3 })).canApply, true);
  const r = ev(cand({ clearance: 1 }), post({ clearance: 3 }));
  assert.deepStrictEqual(codes(r), ['clearance_missing']);
  assert.ok(r.blockers[0].message.includes('Top Secret clearance'));
  assert.ok(!/verified/i.test(r.blockers[0].message));
  assert.deepStrictEqual(codes(ev(cand({ clearance: null }), post({ clearance: 2 }))), ['clearance_missing']);
  assert.strictEqual(ev(cand({ clearance: null }), post({ clearance: null })).canApply, true);
});

t('shift: must match; flexible on either side satisfies', () => {
  const r = ev(cand({ shifts: ['daytime'] }), post({ shift: 'overnight' }));
  assert.deepStrictEqual(codes(r), ['shift_missing']);
  assert.ok(r.blockers[0].message.startsWith('You have not selected to work the hours of this job (overnight).'));
  assert.strictEqual(ev(cand({ shifts: ['daytime', 'overnight'] }), post({ shift: 'overnight' })).canApply, true);
  assert.strictEqual(ev(cand({ shifts: ['flexible'] }), post({ shift: 'overnight' })).canApply, true);
  assert.strictEqual(ev(cand({ shifts: [] }), post({ shift: 'flexible' })).canApply, true);
  assert.deepStrictEqual(codes(ev(cand({ shifts: [] }), post({ shift: 'daytime' }))), ['shift_missing']);
});

t('area: onsite and hybrid check Work Areas, remote does not, remote in area says where', () => {
  assert.deepStrictEqual(codes(ev(cand({ areaMatch: false }), post({ arrangement: 'onsite' }))), ['area_outside']);
  assert.deepStrictEqual(codes(ev(cand({ areaMatch: false }), post({ arrangement: 'hybrid' }))), ['area_outside']);
  assert.strictEqual(ev(cand({ areaMatch: false }), post({ arrangement: 'remote' })).canApply, true);
  const r = ev(cand({ areaMatch: false }), post({ arrangement: 'remote_in_area', areaLabel: 'NY, NJ and CT' }));
  assert.ok(r.blockers[0].message.includes('limited to NY, NJ and CT'));
  assert.deepStrictEqual(codes(ev(cand({ areaMatch: null }), post({ arrangement: 'onsite' }))), ['area_unset']);
  assert.strictEqual(ev(cand({ areaMatch: null }), post({ arrangement: 'remote' })).canApply, true);
});

t('availability blocks only when the start date is firm and the candidate is later', () => {
  const late = cand({ availableFrom: ahead(60) });
  assert.strictEqual(ev(late, post({ startFirm: false })).canApply, true);
  assert.deepStrictEqual(codes(ev(late, post({ startFirm: true }))), ['availability_late']);
  assert.strictEqual(ev(cand({ availableFrom: ahead(10) }), post({ startFirm: true })).canApply, true);
  assert.strictEqual(ev(cand({ availableFrom: null }), post({ startFirm: true })).canApply, true);
});

t('every blocker ends with a withdraw action and has a message', () => {
  const r = ev(cand({ skills: [], education: {}, certs: [], clearance: null, shifts: [], areaMatch: false, availableFrom: ahead(90) }),
    post({ shift: 'overnight', startFirm: true }));
  assert.ok(r.blockers.length >= 7);
  for (const b of r.blockers) {
    assert.ok(b.message && b.message.length > 10);
    assert.deepStrictEqual(b.actions[b.actions.length - 1], { kind: 'withdraw' });
  }
});

t('all blockers are returned together, not just the first', () => {
  const r = ev(cand({ skills: [], shifts: [], clearance: null }), post({ shift: 'overnight' }));
  assert.deepStrictEqual(codes(r), ['skill_missing', 'clearance_missing', 'shift_missing']);
});

t('qualifies ignores account state and having applied, but not requirements', () => {
  assert.strictEqual(g.qualifies(cand({ verified: {}, alreadyApplied: true, membershipActive: false }), post(), NOW), true);
  assert.strictEqual(g.qualifies(cand({ skills: [] }), post(), NOW), false);
  assert.strictEqual(g.qualifies(cand(), post({ status: 'closed' }), NOW), false);
});

console.log(`${passed} apply-gate tests passed`);
