const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const smsService = require('../services/smsService');

// Homepage
router.get('/', (req, res) => {
  res.render('home');
});

// Recruiter landing page
router.get('/recruiter-landing', (req, res) => {
  res.render('recruiter-landing');
});

// Recruiter search/browse page
router.get('/recruiter-search', (req, res) => {
  res.render('recruiter-search');
});

// Candidate landing page
router.get('/candidate-landing', (req, res) => {
  res.render('candidate-landing');
});

// Candidate signup page
router.get('/candidate-signup', (req, res) => {
  res.render('candidate-signup');
});

// Login page
router.get('/login', (req, res) => {
  res.render('login');
});

// Terms of Service
router.get('/terms', (req, res) => {
  res.render('terms');
});

// Privacy Policy
router.get('/privacy', (req, res) => {
  res.render('privacy');
});

// Founding recruiter signup
router.post('/api/founding-recruiter/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await Recruiter.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const recruiter = new Recruiter({
      firstName,
      lastName,
      email,
      phone,
      company: company || 'Not provided',
      isPhoneVerified: false,
      isIdentityVerified: false,
      isActive: false,
      emailVerifiedAt: new Date(),
      domainVerifiedAt: new Date()
    });

    await recruiter.save();

    req.session.recruiterId = recruiter._id.toString();
    req.session.phone = phone;

    const formattedPhone = phone.replace(/\D/g, '');
    const phoneE164 = '+1' + formattedPhone.slice(-10);

    const smsResult = await smsService.sendOTP(phoneE164);

    if (smsResult.success) {
      req.session.phoneOtpRequestId = smsResult.requestId;
      req.session.phoneNumber = phoneE164;
      res.json({
        success: true,
        recruiterId: recruiter._id,
        message: `OTP sent to ${phoneE164}`
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to send verification code'
      });
    }
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ error: 'Failed to complete signup' });
  }
});

router.post('/api/founding-recruiter/resend-code', async (req, res) => {
  try {
    const phone = req.session.phone;
    
    if (!phone) {
      return res.status(400).json({ error: 'No phone on file' });
    }

    const formattedPhone = phone.replace(/\D/g, '');
    const phoneE164 = '+1' + formattedPhone.slice(-10);

    const smsResult = await smsService.sendOTP(phoneE164);

    if (smsResult.success) {
      req.session.phoneOtpRequestId = smsResult.requestId;
      res.json({
        success: true,
        message: `OTP resent to ${phoneE164}`
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to resend code'
      });
    }
  } catch (error) {
    console.error('Error resending code:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

router.post('/api/founding-recruiter/verify-phone', async (req, res) => {
  try {
    const { code } = req.body;
    const requestId = req.session.phoneOtpRequestId;
    const recruiterId = req.session.recruiterId;

    if (!requestId || !code) {
      return res.status(400).json({ error: 'Missing request ID or code' });
    }

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    const result = await smsService.validateOTP(requestId, code);

    if (result.success) {
      await Recruiter.findByIdAndUpdate(recruiterId, {
        isPhoneVerified: true,
        phoneVerifiedAt: new Date()
      });

      req.session.phoneVerified = true;
      res.json({ 
        success: true, 
        message: 'Phone verified successfully' 
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }
  } catch (error) {
    console.error('Error verifying phone OTP:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

router.post('/api/founding-recruiter/create-identity-session', async (req, res) => {
  try {
    const recruiterId = req.session.recruiterId;

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    const recruiter = await Recruiter.findById(recruiterId);
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found' });
    }

    recruiter.isIdentityVerified = true;
    recruiter.isActive = true;
    recruiter.identityVerifiedAt = new Date();
    recruiter.facialRecognitionVerifiedAt = new Date();
    await recruiter.save();

    req.session.identityVerified = true;

    res.json({
      success: true,
      message: 'Identity verification complete. Welcome!',
      recruiter: {
        id: recruiter._id,
        name: `${recruiter.firstName} ${recruiter.lastName}`,
        email: recruiter.email,
        isActive: recruiter.isActive
      }
    });
  } catch (error) {
    console.error('Error creating identity session:', error);
    res.status(500).json({ error: 'Failed to complete verification' });
  }
});

// Recruiter profile page
router.get('/recruiter/:name', async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({
      firstName: req.params.name.split('-')[0],
      lastName: req.params.name.split('-')[1]
    });

    if (!recruiter) {
      return res.status(404).send('Recruiter not found');
    }

    res.render('recruiter-profile', { recruiter });
  } catch (error) {
    console.error('Error fetching recruiter profile:', error);
    res.status(500).send('Error loading profile');
  }
});

// Candidate profile page
router.get('/candidate/:name', (req, res) => {
  res.render('candidate-profile');
});

module.exports = router;