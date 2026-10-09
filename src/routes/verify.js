const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { recordView } = require('../utils/viewTracker');

// GET /verify/:slug — public, live verification page. Anyone holding the
// link (an email signature, an outreach email) can confirm the person is
// really verified. Always reads current database state, so a suspended or
// deactivated account stops showing as verified immediately.
//
// Recruiters are public by default. Candidates only appear if they switched
// their page on (publicVerifyPage), and then only as first name + last
// initial, verified-status checkmarks, and verified certification names —
// no employers, schools, bio or contact details. A private candidate and a
// slug that doesn't exist look identical (same 404) so the page can't be
// used to probe who is on PreCheckd.
router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    const recruiter = await Recruiter.findOne({
      slug,
      isActive: true,
      isSuspended: { $ne: true },
      accountTier: { $ne: 'unverified_claim' }
    });

    if (recruiter) {
      await recordView(req, 'recruiter', recruiter._id, {
        viewerIsOwner: Boolean(req.session.recruiterId && req.session.recruiterId === recruiter._id.toString())
      });

      const company = recruiter.company && recruiter.company !== 'Not provided' ? recruiter.company : null;
      return res.render('verify', {
        pageTitle: `${recruiter.firstName} ${recruiter.lastName} - Verified Recruiter | PreCheckd`,
        v: {
          kind: 'recruiter',
          displayName: `${recruiter.firstName} ${recruiter.lastName}`,
          subtitle: company,
          verified: Boolean(recruiter.isPhoneVerified && recruiter.isIdentityVerified),
          checks: [
            { label: 'Identity verified', ok: Boolean(recruiter.isIdentityVerified) },
            { label: 'Phone verified', ok: Boolean(recruiter.isPhoneVerified) }
          ],
          certs: [],
          memberSince: recruiter.createdAt,
          profileUrl: `/recruiter/${recruiter.slug}`
        }
      });
    }

    const candidate = await Candidate.findOne({ slug, publicVerifyPage: true });

    if (candidate) {
      res.set('X-Robots-Tag', 'noindex, nofollow');

      await recordView(req, 'candidate', candidate._id, {
        viewerIsOwner: Boolean(req.session.candidateId && req.session.candidateId === candidate._id.toString())
      });

      const lastInitial = (candidate.lastName || '').trim().charAt(0).toUpperCase();
      return res.render('verify', {
        pageTitle: 'PreCheckd Verification',
        v: {
          kind: 'candidate',
          displayName: lastInitial ? `${candidate.firstName} ${lastInitial}.` : candidate.firstName,
          subtitle: null,
          verified: Boolean(candidate.isPhoneVerified && candidate.isIdentityVerified),
          checks: [
            { label: 'Identity verified', ok: Boolean(candidate.isIdentityVerified) },
            { label: 'Phone verified', ok: Boolean(candidate.isPhoneVerified) }
          ],
          certs: (candidate.certifications || []).filter((c) => c.verified).map((c) => c.name),
          memberSince: candidate.createdAt,
          profileUrl: null
        }
      });
    }

    res.status(404).render('verify', { pageTitle: 'PreCheckd Verification', v: null });
  } catch (error) {
    console.error('Error loading verification page:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
