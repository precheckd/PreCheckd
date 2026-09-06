const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const smsService = require('../services/smsService');

// Step 1: Create initial recruiter record
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if recruiter already exists
    const existing = await Recruiter.findOne({ corporateEmail: email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create new recruiter (not yet verified)
    const recruiter = new Recruiter({
      firstName,
      lastName,
      corporateEmail: email,
      phone,
      company: company || 'Not provided',
      isPhoneVerified: false,
      isIdentityVerified: false,
      isActive: false
    });

    await recruiter.save();

    // Store recruiter ID in session for this flow
    req.session.recruiterId = recruiter._id.toString();
    req.session.phone = phone;

    // Send SMS OTP immediately after signup
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

// Resend OTP code
router.post('/resend-code', async (req, res) => {
  try {
    const phone = req.session.phone;
    
    if (!phone) {
      return res.status(400).json({ error: 'No phone on file' });
    }

    // Format and send OTP
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

// Verify phone OTP
router.post('/verify-phone', async (req, res) => {
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

    // Validate OTP with Message Central
    const result = await smsService.validateOTP(requestId, code);

    if (result.success) {
      // Update recruiter as phone verified
      await Recruiter.findByIdAndUpdate(recruiterId, {
        isPhoneVerified: true
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

// Create Stripe Identity session (MOCKED for now)
router.post('/create-identity-session', async (req, res) => {
  try {
    const recruiterId = req.session.recruiterId;

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    const recruiter = await Recruiter.findById(recruiterId);
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found' });
    }

    // Mark as identity verified (temporarily mocked)
    recruiter.isIdentityVerified = true;
    recruiter.isActive = true;
    await recruiter.save();

    req.session.identityVerified = true;

    res.json({
      success: true,
      message: 'Identity verification complete. Welcome!',
      recruiter: {
        id: recruiter._id,
        name: `${recruiter.firstName} ${recruiter.lastName}`,
        email: recruiter.corporateEmail,
        isActive: recruiter.isActive
      }
    });
  } catch (error) {
    console.error('Error creating identity session:', error);
    res.status(500).json({ error: 'Failed to complete verification' });
  }
});

module.exports = router;