const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const { generateCertificate } = require('../utils/certificateGenerator');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to do this.');
  }
  next();
}

router.use(requireCandidateLogin);

// GET /candidate/:slug/certificate — generates and downloads a fresh
// Certificate of Verification, owner-only. Regenerated on every request
// so the printed Issued/Good-Through dates and verification statuses are
// always current as of the moment of download, not a stale cached copy.
router.get('/:slug/certificate', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ slug: req.params.slug });

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    if (candidate._id.toString() !== req.session.candidateId) {
      return res.status(403).send('You do not have permission to download this certificate.');
    }

    let resumeBuffer = null;
    if (candidate.resumeUrl) {
      try {
        const resumeResponse = await fetch(candidate.resumeUrl);
        if (resumeResponse.ok) {
          const arrayBuffer = await resumeResponse.arrayBuffer();
          resumeBuffer = Buffer.from(arrayBuffer);
        }
      } catch (fetchError) {
        console.error('Could not fetch resume for certificate merge:', fetchError);
        // Certificate still generates without the resume pages attached.
      }
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pdfBuffer = await generateCertificate(candidate, resumeBuffer, baseUrl);

    const filename = `PreCheckd-Certificate-of-Verification-${candidate.firstName}-${candidate.lastName}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating certificate:', error);
    res.status(500).send('Something went wrong generating your certificate. Please try again.');
  }
});

module.exports = router;