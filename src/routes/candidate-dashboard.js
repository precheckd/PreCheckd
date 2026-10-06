const express = require('express');
const router = express.Router();
const ConnectionRequest = require('../models/ConnectionRequest');
const Candidate = require('../models/Candidate');
const FraudReport = require('../models/FraudReport');
const {
  sendRecruiterConnectionAcceptedEmail,
  sendRecruiterConnectionDeclinedEmail
} = require('../services/emailService');

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  next();
}

router.use(requireCandidateLogin);

// A 'requested' full-access state that's sat unanswered past its window
// is treated as if it never happened, matching the connection request's
// own expiry — see the identical helper in recruiter-dashboard.js.
async function expireStaleFullAccessRequest(request) {
  if (
    request.fullAccessStatus === 'requested' &&
    request.fullAccessExpiresAt &&
    request.fullAccessExpiresAt.getTime() < Date.now()
  ) {
    request.fullAccessStatus = 'none';
    request.fullAccessRequestedAt = null;
    request.fullAccessExpiresAt = null;
    await request.save();
  }
}

// GET /candidate-dashboard/saved-recruiters — saved recruiters now live in
// the Connections address book; this keeps old links/bookmarks working.
router.get('/saved-recruiters', (req, res) => {
  res.redirect('/connections');
});

// GET /candidate-dashboard/scam-check — the sender-email checker (WHOIS
// domain age, PreCheckd contact history, web-search link). Candidate-only,
// like the /api/email-checker/check endpoint it calls.
router.get('/scam-check', (req, res) => {
  res.render('scam-check', { title: 'Scam-check | PreCheckd' });
});

// GET /candidate-dashboard/my-reports — reports this candidate filed while
// logged in. Deliberately minimal: just a receipt that it was submitted
// (date, who they reported, why, what they said) — no status, since
// nothing here has been reviewed and showing a verdict invites a
// "why was it dismissed" conversation this isn't set up to have.
router.get('/my-reports', async (req, res) => {
  try {
    const reports = await FraudReport.find({ reporterCandidateId: req.session.candidateId })
      .sort({ createdAt: -1 });

    const reportsForView = reports.map((r) => ({
      reportedEmail: r.reportedEmail,
      reasonCategory: r.reasonCategory,
      description: r.description,
      createdAt: r.createdAt,
    }));

    res.render('candidate-my-reports', { reports: reportsForView });
  } catch (error) {
    console.error('Error loading candidate reports:', error);
    res.status(500).send('Server error');
  }
});

// GET /candidate-dashboard/requests — everything involving this candidate:
// requests they sent (browsing /recruiter-search) and requests recruiters
// sent them (via /candidate-search). Recruiters are never anonymized on
// this side, so both directions show full recruiter info regardless of
// status — only the candidate's own identity gets hidden pre-connection,
// and that's handled on the recruiter's side of the request, not here.
router.get('/requests', async (req, res) => {
  try {
    const requests = await ConnectionRequest.find({ candidateId: req.session.candidateId })
      .populate('recruiterId')
      .sort({ createdAt: -1 });

    for (const r of requests) {
      await expireStaleFullAccessRequest(r);
    }

    const toView = (r) => {
      const recruiter = r.recruiterId;
      return {
        _id: r._id,
        status: r.status,
        note: r.note,
        initiatedBy: r.initiatedBy,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt,
        fullAccessStatus: r.fullAccessStatus,
        recruiter: {
          name: `${recruiter.firstName} ${recruiter.lastName}`,
          company: recruiter.company && recruiter.company !== 'Not provided' ? recruiter.company : null,
          slug: recruiter.slug,
          photoUrl: recruiter.profilePhotoUrl,
          email: r.status === 'accepted' ? recruiter.email : null
        }
      };
    };

    const sentRequests = requests.filter((r) => r.initiatedBy !== 'recruiter').map(toView);
    const receivedRequests = requests.filter((r) => r.initiatedBy === 'recruiter').map(toView);

    res.render('candidate-requests', { sentRequests, receivedRequests });
  } catch (error) {
    console.error('Error loading candidate requests:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate-dashboard/requests/:id/accept — candidate accepting a
// recruiter-initiated request. Mirrors recruiter-dashboard's accept route
// for the other direction.
router.post('/requests/:id/accept', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id).populate('recruiterId');

    if (!request || request.candidateId.toString() !== req.session.candidateId || request.initiatedBy !== 'recruiter') {
      return res.status(403).send('Not authorized.');
    }

    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();

    const candidate = await Candidate.findById(req.session.candidateId);

    sendRecruiterConnectionAcceptedEmail(
      request.recruiterId.email,
      request.recruiterId.firstName,
      `${candidate.firstName} ${candidate.lastName}`
    ).catch((err) => {
      console.error('Failed to send recruiter acceptance email:', err);
    });

    res.redirect('/candidate-dashboard/requests');
  } catch (error) {
    console.error('Error accepting connection request:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate-dashboard/requests/:id/decline
router.post('/requests/:id/decline', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id).populate('recruiterId');

    if (!request || request.candidateId.toString() !== req.session.candidateId || request.initiatedBy !== 'recruiter') {
      return res.status(403).send('Not authorized.');
    }

    request.status = 'declined';
    request.respondedAt = new Date();
    await request.save();

    const candidate = await Candidate.findById(req.session.candidateId);

    sendRecruiterConnectionDeclinedEmail(
      request.recruiterId.email,
      request.recruiterId.firstName,
      `${candidate.firstName} ${candidate.lastName}`
    ).catch((err) => {
      console.error('Failed to send recruiter decline email:', err);
    });

    res.redirect('/candidate-dashboard/requests');
  } catch (error) {
    console.error('Error declining connection request:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate-dashboard/requests/:id/grant-full-access — candidate
// approves the bundled video+resume request. One decision covers both.
router.post('/requests/:id/grant-full-access', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id);

    if (!request || request.candidateId.toString() !== req.session.candidateId) {
      return res.status(403).send('Not authorized.');
    }

    if (request.status !== 'accepted' || request.fullAccessStatus !== 'requested') {
      return res.status(400).send('There is no pending full-access request on this connection.');
    }

    request.fullAccessStatus = 'granted';
    request.fullAccessRespondedAt = new Date();
    await request.save();

    res.redirect('/candidate-dashboard/requests');
  } catch (error) {
    console.error('Error granting full access:', error);
    res.status(500).send('Server error');
  }
});

// POST /candidate-dashboard/requests/:id/deny-full-access — final for this
// connection; the recruiter can't re-request on it (see ConnectionRequest
// model comment).
router.post('/requests/:id/deny-full-access', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id);

    if (!request || request.candidateId.toString() !== req.session.candidateId) {
      return res.status(403).send('Not authorized.');
    }

    if (request.status !== 'accepted' || request.fullAccessStatus !== 'requested') {
      return res.status(400).send('There is no pending full-access request on this connection.');
    }

    request.fullAccessStatus = 'denied';
    request.fullAccessRespondedAt = new Date();
    await request.save();

    res.redirect('/candidate-dashboard/requests');
  } catch (error) {
    console.error('Error denying full access:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;