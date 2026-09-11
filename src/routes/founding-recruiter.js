const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PinpointSMSVoiceV2Client, SendNotifyTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');
const Recruiter = require('../models/Recruiter');

const smsClient = new PinpointSMSVoiceV2Client({
  region: process.env.AWS_SMS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_SMS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SMS_SECRET_ACCESS_KEY,
  },
});

const NOTIFY_CONFIGURATION_ID = process.env.AWS_NOTIFY_CONFIGURATION_ID;
const NOTIFY_TEMPLATE_ID = process.env.AWS_NOTIFY_TEMPLATE_ID;

function makeSlug(firstName, lastName) {
  const base = `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function sendVerificationCode(phone, code) {
  return smsClient.send(new SendNotifyTextMessageCommand({
    NotifyConfigurationId: NOTIFY_CONFIGURATION_ID,
    DestinationPhoneNumber: phone,
    TemplateId: NOTIFY_TEMPLATE_ID,
    TemplateVariables: { code },
  }));
}

// Step 1: Signup and send real SMS code via AWS Notify
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, nickname, email, phone, company } = req.body;

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
      nickname: nickname && nickname.trim() ? nickname.trim() : null,
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

    const code = generateSixDigitCode();
    req.session.phoneVerificationCode = code;
    req.session.phoneVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    try {
      await sendVerificationCode(phone, code);
      console.log('SMS sent successfully to', phone);
    } catch (smsError) {
      console.error('Failed to send SMS:', smsError);
      return res.status(500).json({ error: 'Failed to send verification code. Please check your phone number and try again.' });
    }

    res.json({
      success: true,
      recruiterId: recruiter._id,
      message: `Verification code sent to ${phone}`
    });
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ error: 'Failed to complete signup' });
  }
});

// Resend OTP (real)
router.post('/resend-code', async (req, res) => {
  try {
    const phone = req.session.phone;

    if (!phone) {
      return res.status(400).json({ error: 'No phone on file' });
    }

    const code = generateSixDigitCode();
    req.session.phoneVerificationCode = code;
    req.session.phoneVerificationExpires = Date.now() + 10 * 60 * 1000;

    await sendVerificationCode(phone, code);

    res.json({
      success: true,
      message: `Verification code resent to ${phone}`
    });
  } catch (error) {
    console.error('Error resending code:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// Verify phone OTP (real)
router.post('/verify-phone', async (req, res) => {
  try {
    const { code } = req.body;
    const recruiterId = req.session.recruiterId;
    const expectedCode = req.session.phoneVerificationCode;
    const expiresAt = req.session.phoneVerificationExpires;

    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }

    if (!recruiterId) {
      return res.status(400).json({ error: 'No active recruiter session' });
    }

    if (!expectedCode || !expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'No verification code on file. Please request a new one.'
      });
    }

    if (Date.now() > expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new one.'
      });
    }

    if (code !== expectedCode) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect verification code. Please try again.'
      });
    }

    await Recruiter.findByIdAndUpdate(recruiterId, {
      isPhoneVerified: true,
      phoneVerifiedAt: new Date()
    });

    req.session.phoneVerified = true;
    delete req.session.phoneVerificationCode;
    delete req.session.phoneVerificationExpires;

    res.json({
      success: true,
      message: 'Phone verified successfully'
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

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    console.log('Stripe Key loaded:', stripeKey ? 'YES' : 'NO - KEY MISSING');

    const stripe = require('stripe')(stripeKey);

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

    recruiter.stripeVerificationSessionId = verificationSession.id;
    await recruiter.save();

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

    const verificationSession = await stripe.identity.verificationSessions.retrieve(sessionId, {
      expand: ['verified_outputs']
    });

    if (verificationSession.status === 'verified') {
      const recruiter = await Recruiter.findById(recruiterId);
      if (!recruiter) {
        return res.status(404).json({ error: 'Recruiter not found' });
      }

      const rawDocFirstName = (verificationSession.verified_outputs?.first_name || '').trim();
      const docFirstName = rawDocFirstName.split(/\s+/)[0] || '';
      const docLastName = (verificationSession.verified_outputs?.last_name || '').trim();

      if (docFirstName && docLastName) {
        recruiter.firstName = docFirstName;
        recruiter.lastName = docLastName;
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