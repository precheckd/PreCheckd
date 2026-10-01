const express = require('express');
const router = express.Router();
const ConnectionRequest = require('../models/ConnectionRequest');
const Recruiter = require('../models/Recruiter');
const FraudReport = require('../models/FraudReport');
const {
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail
} = require('../services/emailService');

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

// GET /recruiter-dashboard/requests — inbox of all connection requests
router.get('/requests', async (req, res) => {
  try {
    const requests = await ConnectionRequest.find({ recruiterId: req.session.recruiterId })
      .populate('candidateId')
      .sort({ createdAt: -1 });

    // Anonymize pending requests — recruiter shouldn't see identifying
    // info until they've made an accept/decline decision. Accepted/declined
    // requests show full real info, since the decision's already been made.
    const requestsForView = requests.map((r) => {
      const candidate = r.candidateId;
      const isPending = r.status === 'pending';

      return {
        _id: r._id,
        status: r.status,
        note: r.note,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt,
        candidate: {
          displayName: isPending ? `Candidate ${candidate.anonId}` : `${candidate.firstName} ${candidate.lastName}`,
          photoUrl: isPending ? null : candidate.profilePhotoUrl,
          workHistory: (candidate.workHistory || []).map((job) => ({
            jobTitle: job.jobTitle,
            employerName: isPending ? null : job.employerName,
            startDate: job.startDate,
            endDate: job.endDate,
            verified: job.verified
          })),
          educationHistory: candidate.educationHistory || [],
          certifications: candidate.certifications || [],
          bio: candidate.bio,
          email: isPending ? null : candidate.email,
          phone: isPending ? null : candidate.phone
        }
      };
    });

    res.render('recruiter-requests', { requests: requestsForView });
  } catch (error) {
    console.error('Error loading recruiter requests:', error);
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