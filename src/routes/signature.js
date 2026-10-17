const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const { properName } = require('../utils/properName');
const sig = require('../services/signature');

// Verified email signature page (any logged-in member). The public badge image
// lives in the separate router below so email clients can load it without a login.
function requireMember(req, res, next) {
  if (req.session.candidateId || req.session.recruiterId) return next();
  return res.redirect('/login');
}

async function load(req) {
  if (req.session.candidateId) {
    const owner = await Candidate.findById(req.session.candidateId);
    return owner ? { kind: 'candidate', owner } : null;
  }
  const owner = await Recruiter.findById(req.session.recruiterId);
  return owner ? { kind: 'recruiter', owner } : null;
}

function lineFrom(req, kind, owner) {
  if (typeof req.query.line === 'string') return req.query.line.replace(/\s+/g, ' ').trim().slice(0, 90);
  return kind === 'recruiter' && owner.company && owner.company !== 'Not provided' ? owner.company : '';
}

function signatureFor(kind, owner, line) {
  const name = `${properName(owner.firstName)} ${properName(owner.lastName)}`.trim();
  const { link, badge } = sig.linksFor(kind, owner);
  return { name, ...sig.build({ name, line, link, badge }) };
}

router.get('/', requireMember, async (req, res) => {
  try {
    const m = await load(req);
    if (!m) return res.redirect('/login');
    const el = sig.eligibility(m.kind, m.owner);
    const line = lineFrom(req, m.kind, m.owner);
    const built = el.ok ? signatureFor(m.kind, m.owner, line) : null;
    res.render('signature', {
      pageTitle: 'Email signature | PreCheckd',
      kind: m.kind, el, line, built,
      enabledNow: req.query.enabled === '1'
    });
  } catch (error) {
    console.error('Error loading signature page:', error);
    res.status(500).send('Server error');
  }
});

// Candidates only: switch on the public verification page right from here.
router.post('/enable-public', requireMember, async (req, res) => {
  try {
    if (!req.session.candidateId) return res.redirect('/signature');
    const candidate = await Candidate.findById(req.session.candidateId);
    if (!candidate || !(candidate.isIdentityVerified && candidate.isPhoneVerified)) return res.redirect('/signature');
    candidate.publicVerifyPage = true;
    await candidate.save();
    res.redirect('/signature?enabled=1');
  } catch (error) {
    console.error('Error enabling public page from signature page:', error);
    res.status(500).send('Server error');
  }
});

router.get('/download.html', requireMember, async (req, res) => {
  try {
    const m = await load(req);
    if (!m || !sig.eligibility(m.kind, m.owner).ok) return res.redirect('/signature');
    const built = signatureFor(m.kind, m.owner, lineFrom(req, m.kind, m.owner));
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="precheckd-signature.html"');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Email signature</title></head><body>\n${built.html}\n</body></html>`);
  } catch (error) {
    console.error('Error downloading signature:', error);
    res.status(500).send('Server error');
  }
});

// --- Public badge image ---------------------------------------------------
// Checked on every load, so a suspended or no-longer-eligible member's badge
// quietly stops showing (a 1x1 transparent image instead).
const path = require('path');
const fs = require('fs');
const BADGE_FILE = path.join(__dirname, '..', '..', 'public', 'email', 'verified-badge.png');
const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const badgeRouter = express.Router();
badgeRouter.get('/:kind/:file', async (req, res) => {
  let png = BLANK;
  try {
    const kind = req.params.kind;
    const slug = String(req.params.file || '').replace(/\.png$/i, '');
    if ((kind === 'candidate' || kind === 'recruiter') && /^[a-z0-9-]{1,120}$/i.test(slug)) {
      const owner = kind === 'candidate' ? await Candidate.findOne({ slug }) : await Recruiter.findOne({ slug });
      if (owner && sig.eligibility(kind, owner).ok) png = fs.readFileSync(BADGE_FILE);
    }
  } catch (error) {
    console.error('Error serving signature badge:', error.message);
  }
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=600');
  res.send(png);
});

module.exports = router;
module.exports.badgeRouter = badgeRouter;
