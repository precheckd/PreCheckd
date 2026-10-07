const express = require('express');
const router = express.Router();
const ConnectionRequest = require('../models/ConnectionRequest');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const FraudReport = require('../models/FraudReport');
const { getAnonymizedCandidateView, getFullCandidateView } = require('../utils/candidateAnonymization');
const { generateCertificate } = require('../utils/certificateGenerator');
const {
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail
} = require('../services/emailService');

const FULL_ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// A 'requested' full-access state that's sat unanswered past its window
// is treated as if it never happened — same expiry pattern as the
// connection request itself — so it can be requested again rather than
// being stuck open forever. Mutates and saves the request when it's
// found to be expired; callers can rely on request.fullAccessStatus
// being accurate immediately after this returns.
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

function requireRecruiterLogin(req, res, next) {
  if (!req.session.recruiterId) {
    return res.redirect('/login');
  }
  next();
}

router.use(requireRecruiterLogin);

// GET /recruiter-dashboard/claim — the only page an unverified_claim
// account can see: the report(s) tied to them, and a locked preview of
// everything that opens up once they verify + pay. A standard (already
// verified) recruiter landing here just gets sent to their real profile.
router.get('/claim', async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.session.recruiterId);

    if (!recruiter) {
      return res.redirect('/login');
    }

    if (recruiter.accountTier !== 'unverified_claim') {
      return res.redirect(`/recruiter/${recruiter.slug}`);
    }

    const reports = await FraudReport.find({ matchedRecruiterId: recruiter._id })
      .sort({ createdAt: -1 });

    // Reporter identity is never shown to the recruiter being reported.
    const reportsForView = reports.map((r) => ({
      reasonCategory: r.reasonCategory,
      description: r.description,
      incidentDate: r.incidentDate,
      createdAt: r.createdAt,
    }));

    res.render('recruiter-claim-dashboard', { recruiter, reports: reportsForView });
  } catch (error) {
    console.error('Error loading claim dashboard:', error);
    res.status(500).send('Something went wrong loading your account.');
  }
});

// GET /recruiter-dashboard/reports — every report on file for a standard
// (already verified/active) recruiter. The unverified_claim equivalent is
// /claim above; this is the same underlying data, just without the locked
// feature preview, since a standard recruiter already has everything else.
router.get('/reports', async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.session.recruiterId);

    if (!recruiter) {
      return res.redirect('/login');
    }

    if (recruiter.accountTier === 'unverified_claim') {
      return res.redirect('/recruiter-dashboard/claim');
    }

    const reports = await FraudReport.find({ matchedRecruiterId: recruiter._id })
      .sort({ createdAt: -1 });

    // Reporter identity is never shown to the recruiter being reported.
    const reportsForView = reports.map((r) => ({
      reasonCategory: r.reasonCategory,
      description: r.description,
      incidentDate: r.incidentDate,
      createdAt: r.createdAt,
    }));

    res.render('recruiter-fraud-reports', { recruiter, reports: reportsForView });
  } catch (error) {
    console.error('Error loading recruiter reports:', error);
    res.status(500).send('Something went wrong loading your reports.');
  }
});

// GET /recruiter-dashboard/requests — inbox of all connection requests
router.get('/requests', async (req, res) => {
  try {
    const requests = await ConnectionRequest.find({ recruiterId: req.session.recruiterId })
      .populate('candidateId')
      .sort({ createdAt: -1 });

    for (const r of requests) {
      await expireStaleFullAccessRequest(r);
    }

    // Pending requests go through the same anonymization used on the
    // candidate-search results — recruiter shouldn't see identifying info
    // until they've made an accept/decline decision. Accepted/declined
    // requests show full real info, since the decision's already been made.
    const requestsForView = requests.map((r) => {
      const candidate = r.candidateId;
      const isPending = r.status === 'pending';

      return {
        _id: r._id,
        status: r.status,
        note: r.note,
        initiatedBy: r.initiatedBy,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt,
        fullAccessStatus: r.fullAccessStatus,
        candidate: isPending ? getAnonymizedCandidateView(candidate) : getFullCandidateView(candidate)
      };
    });

    res.render('recruiter-requests', { requests: requestsForView });
  } catch (error) {
    console.error('Error loading recruiter requests:', error);
    res.status(500).send('Server error');
  }
});

// GET /recruiter-dashboard/requests/:id/candidate — full profile view for
// an accepted connection. Video and resume only render once fullAccessStatus
// is 'granted' — the view itself shows a "Request Full Access" button when
// it isn't, rather than this route gating the whole page on it.
router.get('/requests/:id/candidate', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id).populate('candidateId');

    if (!request || request.recruiterId.toString() !== req.session.recruiterId) {
      return res.status(403).send('Not authorized.');
    }

    if (request.status !== 'accepted') {
      return res.status(403).send('You can only view a full profile once the connection is accepted.');
    }

    await expireStaleFullAccessRequest(request);

    const candidate = request.candidateId;
    const hasFullAccess = request.fullAccessStatus === 'granted';

    res.render('recruiter-candidate-profile', {
      requestId: request._id,
      fullAccessStatus: request.fullAccessStatus,
      candidate: getFullCandidateView(candidate),
      video: hasFullAccess ? {
        introVideoUrl: candidate.introVideoUrl,
        interviewVideos: candidate.interviewVideos || []
      } : null,
      resumeUrl: hasFullAccess && candidate.resumeUrl ? `/recruiter-dashboard/requests/${request._id}/resume` : null,
      title: `${candidate.firstName} ${candidate.lastName} | PreCheckd`
    });
  } catch (error) {
    console.error('Error loading recruiter candidate profile:', error);
    res.status(500).send('Server error');
  }
});

// GET /recruiter-dashboard/requests/:id/resume — the candidate's resume with
// the PreCheckd Certificate of Verification appended, instead of the raw
// upload. Same access rule as the resume link it replaces: accepted
// connection AND full access granted.
router.get('/requests/:id/resume', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id).populate('candidateId');

    if (!request || request.recruiterId.toString() !== req.session.recruiterId) {
      return res.status(403).send('Not authorized.');
    }

    if (request.status !== 'accepted' || request.fullAccessStatus !== 'granted') {
      return res.status(403).send('Full access has not been granted for this candidate.');
    }

    const candidate = request.candidateId;
    if (!candidate || !candidate.resumeUrl) {
      return res.status(404).send('No resume on file.');
    }

    let resumeBuffer = null;
    try {
      const resumeResponse = await fetch(candidate.resumeUrl);
      if (resumeResponse.ok) {
        resumeBuffer = Buffer.from(await resumeResponse.arrayBuffer());
      }
    } catch (fetchError) {
      console.error('Could not fetch resume for verified download:', fetchError);
    }

    if (!resumeBuffer) {
      return res.status(502).send('Could not load the resume. Please try again.');
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pdfBuffer = await generateCertificate(candidate, resumeBuffer, baseUrl);

    const filename = `PreCheckd-Verified-Resume-${candidate.firstName}-${candidate.lastName}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating verified resume:', error);
    res.status(500).send('Something went wrong. Please try again.');
  }
});

// POST /recruiter-dashboard/requests/:id/request-full-access — bundled
// video + resume access request. Only allowed once the connection itself
// is accepted, and only from a 'none' state — a 'denied' decision is
// final for this connection, and 'requested'/'granted' are no-ops here.
router.post('/requests/:id/request-full-access', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id).populate('candidateId');

    if (!request || request.recruiterId.toString() !== req.session.recruiterId) {
      return res.status(403).send('Not authorized.');
    }

    if (request.status !== 'accepted') {
      return res.status(403).send('You can only request full access on an accepted connection.');
    }

    await expireStaleFullAccessRequest(request);

    if (request.fullAccessStatus === 'none') {
      request.fullAccessStatus = 'requested';
      request.fullAccessRequestedAt = new Date();
      request.fullAccessExpiresAt = new Date(Date.now() + FULL_ACCESS_WINDOW_MS);
      await request.save();
    }

    res.redirect(`/recruiter-dashboard/requests/${request._id}/candidate`);
  } catch (error) {
    console.error('Error requesting full access:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-dashboard/requests/:id/accept
router.post('/requests/:id/accept', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id).populate('candidateId');

    if (!request || request.recruiterId.toString() !== req.session.recruiterId) {
      return res.status(403).send('Not authorized.');
    }

    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();

    const recruiter = await Recruiter.findById(req.session.recruiterId);

    sendConnectionAcceptedEmail(
      request.candidateId.email,
      request.candidateId.firstName,
      `${recruiter.firstName} ${recruiter.lastName}`,
      recruiter.email
    ).catch((err) => {
      console.error('Failed to send acceptance email:', err);
    });

    res.redirect('/recruiter-dashboard/requests');
  } catch (error) {
    console.error('Error accepting connection request:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-dashboard/requests/:id/decline
router.post('/requests/:id/decline', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.id).populate('candidateId');

    if (!request || request.recruiterId.toString() !== req.session.recruiterId) {
      return res.status(403).send('Not authorized.');
    }

    request.status = 'declined';
    request.respondedAt = new Date();
    await request.save();

    const recruiter = await Recruiter.findById(req.session.recruiterId);

    sendConnectionDeclinedEmail(
      request.candidateId.email,
      request.candidateId.firstName,
      `${recruiter.firstName} ${recruiter.lastName}`
    ).catch((err) => {
      console.error('Failed to send decline email:', err);
    });

    res.redirect('/recruiter-dashboard/requests');
  } catch (error) {
    console.error('Error declining connection request:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;