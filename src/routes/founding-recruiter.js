const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const smsService = require('../services/smsService');

// Step 1: Create initial recruiter record
router.post('/create-recruiter', async (req, res) => {
  try {
    const { firstName, lastName, corporateEmail, phone, company } = req.body;

    if (!firstName || !lastName || !corporateEmail || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if recruiter already exists
    const existing = await Recruiter.findOne({ corporateEmail });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create new recruiter (not yet verified)
    const recruiter = new Recruiter({
      firstName,
      lastName,
      corporateEmail,
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

    res.json({
      success: true,
      recruiterId: recruiter._id,
      message: 'Recruiter created. Proceeding to phone verification.'
    });
  } catch (error) {
    console.error('Error creating recruiter:', error);
    res.status(500).json({ error: 'Failed to create recruiter' });
  }
});

// Step 2: Send SMS OTP to phone
router.post('/send-phone-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    // Format phone number to E.164 format (+1XXXXXXXXXX)
    const formattedPhone = phone.replace(/\D/g, '');
    const phoneE164 = '+1' + formattedPhone.slice(-10);

    // Send OTP via Message Central
    const result = await smsService.sendOTP(phoneE164);

    if (result.success) {
      // Store requestId in session for validation
      req.session.phoneOtpRequestId = result.requestId;
      req.session.phoneNumber = phoneE164;
      res.json({
        success: true,
        message: `OTP sent to ${phoneE164}`
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error sending phone OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Step 3: Verify phone OTP
router.post('/verify-phone', async (req, res) => {
  try {
    const { otp } = req.body;
    const requestId = req.session.phoneOtpRequestId;
    const recruiterId = req.session.recruiterId;

    if (!requestId || !otp) {
      return res.status(400).json({ error: 'Missing request ID or OTP' });
    }

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    // Validate OTP with Message Central
    const result = await smsService.validateOTP(requestId, otp);

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
        error: 'Invalid OTP'
      });
    }
  } catch (error) {
    console.error('Error verifying phone OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Step 4: Create Stripe Identity session for facial recognition (MOCKED for now)
// TODO: Replace with real Stripe Identity when account is activated
router.post('/create-identity-session', async (req, res) => {
  try {
    const recruiterId = req.session.recruiterId;

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    // TEMPORARY: Mock Stripe Identity response
    // Once Stripe account is activated on Sept 7, replace with real Stripe API call
    const recruiter = await Recruiter.findById(recruiterId);
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found' });
    }

    // Mark as identity verified (temporarily mocked)
    recruiter.isIdentityVerified = true;
    recruiter.isActive = true; // Recruiter is now fully verified
    await recruiter.save();

    req.session.identityVerified = true;

    res.json({
      success: true,
      message: 'Identity verification complete. Recruiter profile activated.',
      recruiter: {
        id: recruiter._id,
        name: `${recruiter.firstName} ${recruiter.lastName}`,
        email: recruiter.corporateEmail,
        isActive: recruiter.isActive
      }
    });
  } catch (error) {
    console.error('Error creating identity session:', error);
    res.status(500).json({ error: 'Failed to create identity session' });
  }
});

// Get recruiter status
router.get('/recruiter-status', async (req, res) => {
  try {
    const recruiterId = req.session.recruiterId;

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    const recruiter = await Recruiter.findById(recruiterId);
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found' });
    }

    res.json({
      success: true,
      recruiter: {
        id: recruiter._id,
        name: `${recruiter.firstName} ${recruiter.lastName}`,
        email: recruiter.corporateEmail,
        company: recruiter.company,
        isPhoneVerified: recruiter.isPhoneVerified,
        isIdentityVerified: recruiter.isIdentityVerified,
        isActive: recruiter.isActive,
        createdAt: recruiter.createdAt
      }
    });
  } catch (error) {
    console.error('Error getting recruiter status:', error);
    res.status(500).json({ error: 'Failed to get recruiter status' });
  }
});

module.exports = router;