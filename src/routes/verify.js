const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const { recordView } = require('../utils/viewTracker');

// GET /verify/:slug — public, live verification page for CANDIDATES. Anyone
// holding the link (an email signature) can confirm the person is really
// verified. Always reads current database state.
//
// Recruiters don't use this page: their public profile at /recruiter/:slug
// already does the job. Keeping /verify candidate-only also avoids slug
// collisions, since a recruiter and a candidate with the same name both get
// the same plain "first-last" slug (slugs are only unique within each model).
//
// A candidate appears only if they switched their page on
// (publicVerifyPage), and then only as first name + last initial,
// verified-status checkmarks, and verified certification names — no
// employers, schools, bio or contact details. A private candidate and a slug
// that doesn't exist look identical (same 404) so the page can't be used to
// probe who is on PreCheckd.
// Whole months between a "YYYY-MM" start and an end ("YYYY-MM" or null = now).
function monthsBetween(start, end, now = new Date()) {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{2})$/.exec(value || '');
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
  };
  const from = parse(start);
  if (from === null) return null;
  const to = end ? parse(end) : now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (to === null || to < from) return null;
  return to - from;
}

function yearsLabel(months) {
  if (months === null) return null;
  if (months < 12) return 'under 1 year';
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

// Verified job titles with total tenure per title. Employer names are never
// included. Entries with the same title are combined.
function verifiedJobTitles(workHistory, now) {
  const byTitle = new Map();
  (workHistory || []).filter((job) => job.verified).forEach((job) => {
    const key = job.jobTitle.trim().toLowerCase();
    const months = monthsBetween(job.startDate, job.endDate, now);
    const entry = byTitle.get(key) || { title: job.jobTitle.trim(), months: 0, known: false };
    if (months !== null) {
      entry.months += months;
      entry.known = true;
    }
    byTitle.set(key, entry);
  });
  return [...byTitle.values()].map((entry) => ({
    title: entry.title,
    tenure: entry.known ? yearsLabel(entry.months) : null
  }));
}

router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    const candidate = await Candidate.findOne({ slug, publicVerifyPage: true });

    if (candidate) {
      res.set('X-Robots-Tag', 'noindex, nofollow');

      await recordView(req, 'candidate', candidate._id, {
        viewerIsOwner: Boolean(req.session.candidateId && req.session.candidateId === candidate._id.toString())
      });

      const saved = candidate.publicSections || {};
      const sections = {
        certifications: saved.certifications !== false,
        degrees: saved.degrees === true,
        jobTitles: saved.jobTitles === true
      };

      const lastInitial = (candidate.lastName || '').trim().charAt(0).toUpperCase();
      return res.render('verify', {
        pageTitle: 'PreCheckd Verification',
        viewerIsRecruiter: Boolean(req.session.recruiterId),
        viewerIsSignedIn: Boolean(req.session.recruiterId || req.session.candidateId),
        v: {
          kind: 'candidate',
          displayName: lastInitial ? `${candidate.firstName} ${lastInitial}.` : candidate.firstName,
          subtitle: null,
          verified: Boolean(candidate.isPhoneVerified && candidate.isIdentityVerified),
          checks: [
            { label: 'Identity verified', ok: Boolean(candidate.isIdentityVerified) },
            { label: 'Phone verified', ok: Boolean(candidate.isPhoneVerified) }
          ],
          certs: sections.certifications
            ? (candidate.certifications || []).filter((c) => c.verified).map((c) => c.name)
            : [],
          degrees: sections.degrees
            ? (candidate.educationHistory || []).filter((e) => e.verified).map((e) => e.degree)
            : [],
          jobs: sections.jobTitles ? verifiedJobTitles(candidate.workHistory) : [],
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
module.exports._verifiedJobTitles = verifiedJobTitles;
