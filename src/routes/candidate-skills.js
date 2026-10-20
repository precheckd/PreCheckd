const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const skills = require('../services/skills');
const SkillRequest = require('../models/SkillRequest');

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
        held: !!(lastDone && lastDone.held && lastDone.reviewDecision !== 'approved'),
        rejected: !!(lastDone && lastDone.reviewDecision === 'rejected')
      });
    }
    const finished = req.query.finished === '1';
    const processing = finished && !attempts.some((r) => r.status === 'completed' && Date.now() - r.completedAt < 600000);
    res.render('candidate-skills', {
      candidate, cards,
      skillCards: cards.filter((c) => c.assessment.kind !== 'title'),
      titleCards: cards.filter((c) => c.assessment.kind === 'title'),
      titles,
      requests: await SkillRequest.find({ candidateId: candidate._id }).sort({ createdAt: -1 }),
      current: current.map((s) => ({ ...s, shown: !hidden.has(s.key), showable: skills.SHOWABLE.has(s.level) })),
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
    if (e.code === 'retake_wait') return res.redirect(`/candidate/${req.params.slug}/skills?notice=wait`);
    if (e.code === 'not_found') return res.status(404).send('Assessment not available.');
    console.error('Error starting skills assessment:', e);
    res.status(500).send('Server error');
  }
});

router.post('/:slug/skills/visibility', async (req, res) => {
  try {
    const candidate = await owned(req, res);
    if (!candidate) return;
    const shown = [].concat(req.body.shown || []);
    await skills.setHidden(candidate, shown);
    res.redirect(`/candidate/${candidate.slug}/skills?notice=saved`);
  } catch (e) {
    console.error('Error saving skill visibility:', e);
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
