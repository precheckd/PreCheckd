const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const ConnectionRequest = require('../models/ConnectionRequest');
const {
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail
} = require('../services/emailService');

// Require a logged-in recruiter for every route in this file
function requireRecruiterLogin(req, res, next) {
  if (!req.session.recruiterId) {
    return res.redirect('/login');
  }
  next();
}

router.use(requireRecruiterLogin);

// GET /recruiter-dashboard/requests — inbox of connection requests
router.get('/requests', async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.session.recruiterId);
    if (!recruiter) {
      return res.status(404).send('Recruiter not found');
    }

    const requests = await ConnectionRequest.find({ recruiterId: recruiter._id })
      .sort({ createdAt: -1 })
      .populate('candidateId');

    res.render('recruiter-requests', {
      recruiter,
      requests,
      title: 'Connection Requests | PreCheckd'
    });
  } catch (error) {
    console.error('Error loading connection requests:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-dashboard/requests/:id/accept
router.post('/requests/:id/accept', async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.session.recruiterId);
    if (!recruiter) {
      return res.status(404).send('Recruiter not found');
    }

    const request = await ConnectionRequest.findOne({
      _id: req.params.id,
      recruiterId: recruiter._id,
      status: 'pending'
    }).populate('candidateId');

    if (!request) {
      return res.status(404).send('Request not found or already handled');
    }

    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();

    const candidate = request.candidateId;
    sendConnectionAcceptedEmail(
      candidate.email,
      candidate.firstName,
      `${recruiter.firstName} ${recruiter.lastName}`,
      recruiter.email
    ).catch((err) => console.error('Failed to send acceptance email:', err));

    res.redirect('/recruiter-dashboard/requests');
  } catch (error) {
    console.error('Error accepting connection request:', error);
    res.status(500).send('Server error');
  }
});

// POST /recruiter-dashboard/requests/:id/decline
router.post('/requests/:id/decline', async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.session.recruiterId);
    if (!recruiter) {
      return res.status(404).send('Recruiter not found');
    }

    const request = await ConnectionRequest.findOne({
      _id: req.params.id,
      recruiterId: recruiter._id,
      status: 'pending'
    }).populate('candidateId');

    if (!request) {
      return res.status(404).send('Request not found or already handled');
    }

    request.status = 'declined';
    request.respondedAt = new Date();
    await request.save();

    const candidate = request.candidateId;
    sendConnectionDeclinedEmail(
      candidate.email,
      candidate.firstName,
      `${recruiter.firstName} ${recruiter.lastName}`
    ).catch((err) => console.error('Failed to send decline email:', err));

    res.redirect('/recruiter-dashboard/requests');
  } catch (error) {
    console.error('Error declining connection request:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;