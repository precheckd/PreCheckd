const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Recruiter = require('../models/Recruiter');

function makeSlug(firstName, lastName) {
  const base = `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

// Step 1: Signup and mock SMS send
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await Recruiter.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const slug = makeSlug(firstName, lastName);

    const recruiter = new Recruiter({
      firstName,
      lastName,
      slug,
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

    // MOCKED: Pretend SMS was sent successfully
    req.session.phoneOtpRequestId = 'mock-request-' + Date.now();
    req.session.phoneNumber = phone;

    res.json({
      success: true,
      recruiterId: recruiter._id,
      message: `OTP sent to ${phone} (TEST MODE - enter any 6-digit code)`
    });
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ error: 'Failed to complete signup' });
  }
});

// Resend OTP (mocked)
router.post('/resend-code', async (req, res) => {
  try {
    const phone = req.session.phone;
    
    if (!phone) {
      return res.status(400).json({ error: 'No phone on file' });
    }

    // MOCKED: Pretend SMS was resent successfully
    req.session.phoneOtpRequestId = 'mock-request-' + Date.now();

    res.json({
      success: true,
      message: `OTP resent to ${phone} (TEST MODE - enter any 6-digit code)`
    });
  } catch (error) {
    console.error('Error resending code:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// Verify phone OTP (mocked - accepts any code)
router.post('/verify-phone', async (req, res) => {
  try {
    const { code } = req.body;
    const recruiterId = req.session.recruiterId;

    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    // MOCKED: Accept any 6-digit code
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 6-digit code'
      });
    }

    // Mark as verified
    await Recruiter.findByIdAndUpdate(recruiterId, {
      isPhoneVerified: true,
      phoneVerifiedAt: new Date()
    });

    req.session.phoneVerified = true;
    res.json({ 
      success: true, 
      message: 'Phone verified successfully (TEST MODE)' 
    });
  } catch (error) {
    console.error('Error verifying phone OTP:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Create Stripe Identity Session (REAL - actual Stripe integration with logging)
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

    // Log to check if Stripe key is loaded
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    console.log('Stripe Key loaded:', stripeKey ? 'YES' : 'NO - KEY MISSING');

    const stripe = require('stripe')(stripeKey);

    // Create actual Stripe Identity Verification Session
    console.log('Creating Stripe Identity session for:', recruiter.email);
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: 'document',
      options: {
        document: {
          require_matching_selfie: true
        }
      },
      metadata: {
        recruiterId: recruiterId,
        email: recruiter.email,
        name: `${recruiter.firstName} ${recruiter.lastName}`
      }
    });

    console.log('Stripe session created:', verificationSession.id);

    // Store the verification session ID in the recruiter record for later verification
    recruiter.stripeVerificationSessionId = verificationSession.id;
    await recruiter.save();

    // Return the client secret to the frontend
    res.json({
      success: true,
      message: 'Identity verification session created',
      clientSecret: verificationSession.client_secret,
      sessionId: verificationSession.id
    });
  } catch (error) {
    console.error('Error creating identity session:', error);
    res.status(500).json({ error: 'Failed to create identity verification session' });
  }
});

// Verify Stripe Identity Session result
router.post('/verify-identity-session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const recruiterId = req.session.recruiterId;

    if (!recruiterId || !sessionId) {
      return res.status(400).json({ error: 'Missing recruiter or session ID' });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const stripe = require('stripe')(stripeKey);

    // Retrieve the verification session from Stripe, expanding the extracted name
    const verificationSession = await stripe.identity.verificationSessions.retrieve(sessionId, {
      expand: ['verified_outputs']
    });

    // Check if verification was successful
    if (verificationSession.status === 'verified') {
      const recruiter = await Recruiter.findById(recruiterId);
      if (!recruiter) {
        return res.status(404).json({ error: 'Recruiter not found' });
      }

      const docFirstName = (verificationSession.verified_outputs?.first_name || '').trim().toLowerCase();
      const docLastName = (verificationSession.verified_outputs?.last_name || '').trim().toLowerCase();
      const formFirstName = recruiter.firstName.trim().toLowerCase();
      const formLastName = recruiter.lastName.trim().toLowerCase();

      const nameMatches = docFirstName === formFirstName && docLastName === formLastName;

      if (!nameMatches) {
        console.warn(
          `Name mismatch for recruiter ${recruiterId}: form="${recruiter.firstName} ${recruiter.lastName}" doc="${verificationSession.verified_outputs?.first_name} ${verificationSession.verified_outputs?.last_name}"`
        );
        return res.status(400).json({
          success: false,
          message: 'The name on your ID does not match the name you entered. Please contact support.'
        });
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
          isActive: recruiter.isActive,
          slug: recruiter.slug
        }
      });
    } else if (verificationSession.status === 'requires_input') {
      res.status(400).json({
        success: false,
        message: 'Verification incomplete. Please try again.'
      });
    } else {
      res.status(400).json({
        success: false,
        message: `Verification failed with status: ${verificationSession.status}`
      });
    }
  } catch (error) {
    console.error('Error verifying identity session:', error);
    res.status(500).json({ error: 'Failed to verify identity session' });
  }
});

module.exports = router;