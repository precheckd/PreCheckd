const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const skills = require('../services/skills');
const SkillRequest = require('../models/SkillRequest');
const testRequests = require('../services/testRequests');
const ach = require('../services/achievements');
const { ROLES } = require('../content/roles');
const { levelName } = require('../utils/levelName');

const prettyKey = (k) => String(k).split('-').map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
const shortDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// One plain record per testable skill, used by "Your skills", the browse list and the search box.
function buildSkillIndex(ladders, skillCards, current, levelName) {
  const cur = new Map(current.map((x) => [x.key, x]));
  const out = new Map();
  for (const g of ladders) {
    const next = g.rungs.find((r) => !r.passed);
    const started = g.rungs.some((r) => r.result || r.open || r.held || r.rejected);
    const canStart = !!(next && !next.locked && !next.retakeOn && !next.held);
    out.set(g.key, { key: g.key, label: g.label, level: g.level ? levelName(g.level, g.grandmaster) : null, started: !!g.level || started,
      startId: canStart ? next.assessment.assessmentId : null,
      startText: canStart ? (next.open ? 'Continue ' : 'Start ') + next.tierName : null,
      note: next && next.retakeOn ? 'Retake ' + shortDay(next.retakeOn) : (next && next.held ? 'In review' : '') });
  }
  for (const c of skillCards) {
    const sk = (c.assessment.skills || [])[0];
    if (!sk || out.has(sk.key)) continue;
    const x = cur.get(sk.key);
    out.set(sk.key, { key: sk.key, label: sk.label, level: x ? levelName(x.level, x.grandmaster) : null, started: !!x || !!c.open,
      startId: !c.retakeOn && !c.held ? c.assessment.assessmentId : null,
      startText: !c.retakeOn && !c.held ? (c.open ? 'Continue' : (x ? 'Retake' : 'Start')) : null,
      note: c.retakeOn ? 'Retake ' + shortDay(c.retakeOn) : (c.held ? 'In review' : '') });
  }
  return out;
}

// CoderByte's "post assessment redirect URL" points here. The candidate's session cookie is
// what identifies them (CoderByte passes nothing we need), so a logged-out visitor goes to login.
// Mounted at /skills/complete in app.js, outside /candidate, because earlier /candidate routers 403 logged-out visitors.
async function complete(req, res) {
  if (!req.session.candidateId) return res.redirect('/login');
  try {
    const candidate = await Candidate.findById(req.session.candidateId);
    if (!candidate) return res.redirect('/login');
    res.redirect(`/candidate/${candidate.slug}/skills?finished=1`);
  } catch (e) {
    console.error('skills complete redirect failed:', e);
    res.status(500).send('Server error');
  }
}
router.complete = complete;

async function owned(req, res) {
  if (!req.session.candidateId) { res.status(403).send('You must be logged in to view this page.'); return null; }
  const candidate = await Candidate.findOne({ slug: req.params.slug });
  if (!candidate) { res.status(404).send('Candidate not found.'); return null; }
  if (candidate._id.toString() !== req.session.candidateId) {
    res.status(403).send('You do not have permission to view this page.'); return null;
  }
  return candidate;
}

router.get('/:slug/skills', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    const [assessments, current, titles, attempts] = await Promise.all([
      SkillAssessment.find({ active: true }).sort({ name: 1 }),
      skills.currentSkills(candidate._id),
      skills.titleResults(candidate._id),
      SkillResult.find({ candidateId: candidate._id }).sort({ invitedAt: -1 })
    ]);
    const hidden = new Set(candidate.hiddenSkillKeys || []);
    const cards = [];
    for (const a of assessments) {
      const mine = attempts.filter((r) => r.assessmentId === a.assessmentId);
      const open = mine.find((r) => ['invited', 'started'].includes(r.status) && r.expiresAt > new Date());
      const lastDone = mine.find((r) => r.status === 'completed');
      cards.push({
        assessment: a,
        retakeOn: await skills.nextAllowed(candidate._id, a),
        open,
        // Finished but waiting on the integrity review, or still being scored.
        held: !!(lastDone && lastDone.held && !lastDone.reviewDecision),
        rejected: !!(lastDone && lastDone.reviewDecision === 'rejected')
      });
    }
    const skillCardsOnly = cards.filter((c) => !['title', 'finalist', 'custom'].includes(c.assessment.kind) && !c.assessment.tier);
    const ladderList = skills.buildLadders(cards, current);
    const index = buildSkillIndex(ladderList, skillCardsOnly, current, levelName);
    const skillList = [...index.values()].sort((a, b) => a.label.localeCompare(b.label));
    const searchData = {
      skills: skillList,
      roles: ROLES.map((r) => ({ id: r.id, title: r.title, skills: r.skills.map((k) => ({ key: k, label: index.has(k) ? index.get(k).label : prettyKey(k) })) }))
    };
    const finished = req.query.finished === '1';
    const processing = finished && !attempts.some((r) => r.status === 'completed' && Date.now() - r.completedAt < 600000);
    res.render('candidate-skills', {
      candidate, cards,
      skillCards: skillCardsOnly,
      ladders: ladderList, skillList, searchData,
      titleCards: cards.filter((c) => c.assessment.kind === 'title' && !c.assessment.roleKey),
      titles,
      testRequests: await testRequests.pendingFor(candidate),
      roleTests: await require('../services/roleTests').pendingFor(candidate),
      requests: await SkillRequest.find({ candidateId: candidate._id }).sort({ createdAt: -1 }),
      current: current.map((s) => {
        const shared = (candidate.sharedSkills || []).includes(s.key) && ach.SHAREABLE.has(s.level);
        const v = shared ? ach.publicView(candidate, s.key) : null;
        const url = ach.urlFor(candidate, s.key);
        return { ...s, shown: !hidden.has(s.key), showable: skills.SHOWABLE.has(s.level),
          shareable: ach.SHAREABLE.has(s.level), shared: !!v, shareUrl: url,
          links: v ? ach.shareLinks(v, url) : null, liProfile: v ? ach.linkedinProfileLink(v, url) : null };
      }),
      achievementVisits: candidate.achievementVisits || 0,
      finished, processing, RETAKE_DAYS: skills.RETAKE_DAYS,
      notice: req.query.notice || null,
      title: 'Skills | PreCheckd'
    });
  } catch (e) {
    console.error('Error loading skills page:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/skills/start/:assessmentId', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    const attempt = await skills.startAttempt(candidate, req.params.assessmentId);
    res.redirect(attempt.inviteUrl);
  } catch (e) {
    if (e.code === 'manual') return res.redirect(`/candidate/${req.params.slug}/skills?notice=manual`);
    if (e.code === 'locked') return res.redirect(`/candidate/${req.params.slug}/skills?notice=locked`);
    if (e.code === 'retake_wait') return res.redirect(`/candidate/${req.params.slug}/skills?notice=wait`);
    if (e.code === 'not_found') return res.status(404).send('Assessment not available.');
    console.error('Error starting skills assessment:', e);
    res.status(500).send('Server error');
  }
});

// The role test for a job the candidate applied to. Starting it opens their private CoderByte link.
router.post('/:slug/skills/role-tests/:id/start', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    const attempt = await require('../services/roleTests').start(candidate, req.params.id);
    res.redirect(attempt.inviteUrl);
  } catch (e) {
    const back = (n) => res.redirect(`/candidate/${req.params.slug}/skills?notice=${n}`);
    if (e.code === 'retake_wait') return back('wait');
    if (e.code === 'manual') return back('manual');
    if (e.code === 'not_found' || e.code === 'not_ready') return back('req_closed');
    console.error('Error starting role test:', e);
    res.status(500).send('Server error');
  }
});

// A recruiter's title-test request. Accepting starts the test; the exact score then goes to that recruiter.
router.post('/:slug/skills/test-requests/:id/accept', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    const attempt = await testRequests.accept(candidate, req.params.id);
    res.redirect(attempt.inviteUrl);
  } catch (e) {
    const back = (n) => res.redirect(`/candidate/${req.params.slug}/skills?notice=${n}`);
    if (e.code === 'expired' || e.code === 'not_found') return back('req_closed');
    if (e.code === 'retake_wait') return back('wait');
    if (e.code === 'manual') return back('manual');
    console.error('Error accepting test request:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/skills/test-requests/:id/decline', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    await testRequests.decline(candidate, req.params.id);
    res.redirect(`/candidate/${req.params.slug}/skills?notice=req_declined`);
  } catch (e) {
    if (e.code === 'expired' || e.code === 'not_found') return res.redirect(`/candidate/${req.params.slug}/skills?notice=req_closed`);
    console.error('Error declining test request:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/skills/visibility', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    const shown = [].concat(req.body.shown || []);
    candidate.showSkillBreakdown = req.body.breakdown === 'on';
    await skills.setHidden(candidate, shown);
    res.redirect(`/candidate/${candidate.slug}/skills?notice=saved`);
  } catch (e) {
    console.error('Error saving skill visibility:', e);
    res.status(500).send('Server error');
  }
});

// Opt in or out of sharing one skill level publicly. Nothing is posted anywhere by us.
router.post('/:slug/skills/share', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    const key = String(req.body.key || '').slice(0, 80);
    await ach.setShared(candidate, key, req.body.on === '1');
    res.redirect(`/candidate/${candidate.slug}/skills#share-${encodeURIComponent(key)}`);
  } catch (e) {
    console.error('Error saving share choice:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/skills/request', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    await skills.requestSkill(candidate, req.body.skill);
    res.redirect(`/candidate/${candidate.slug}/skills?notice=requested`);
  } catch (e) {
    if (['invalid', 'exists', 'limit'].includes(e.code)) return res.redirect(`/candidate/${req.params.slug}/skills?notice=${e.code}`);
    console.error('Error requesting skill:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/skills/email-prefs', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    candidate.skillRemindersOptOut = req.body.reminders !== 'on';
    await candidate.save();
    res.redirect(`/candidate/${candidate.slug}/skills?notice=saved`);
  } catch (e) {
    console.error('Error saving skill email prefs:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/skills/titles', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    await skills.setTitleVisibility(candidate, [].concat(req.body.shown || []));
    res.redirect(`/candidate/${candidate.slug}/skills?notice=saved`);
  } catch (e) {
    console.error('Error saving title visibility:', e);
    res.status(500).send('Server error');
  }
});

module.exports = router;
