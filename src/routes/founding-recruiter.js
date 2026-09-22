const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PinpointSMSVoiceV2Client, SendNotifyTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');
const Recruiter = require('../models/Recruiter');
const { sendVerificationEmail, generateVerificationToken } = require('../services/emailService');
const { isBlockedEmailDomain } = require('../utils/blockedEmailDomains');
const { checkDomainAge } = require('../utils/domainAgeCheck');

const MOCK_SMS = process.env.MOCK_SMS === 'true';

const smsClient = new PinpointSMSVoiceV2Client({
  region: process.env.AWS_SMS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_SMS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SMS_SECRET_ACCESS_KEY,
  },
});

const NOTIFY_CONFIGURATION_ID = process.env.AWS_NOTIFY_CONFIGURATION_ID;
const NOTIFY_TEMPLATE_ID = process.env.AWS_NOTIFY_TEMPLATE_ID;

// Tries the clean firstname-lastname slug first; only appends a suffix
// if that clean version is already taken.
async function makeSlug(firstName, lastName) {
  const base = `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const existing = await Recruiter.findOne({ slug: base });
  if (!existing) {
    return base;
  }

  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Normalizes to E.164 format, but ONLY accepts US numbers (+1 followed by
// 10 digits). Anything that would normalize to a non-US country code is
// rejected outright — PreCheckd is US recruiters for US jobs only.
function normalizePhoneToE164(rawPhone) {
  const digitsOnly = rawPhone.replace(/\D/g, '');

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }

  // If they typed a "+" prefix themselves, only accept it if it's
  // specifically a well-formed US number (+1 followed by exactly 10 digits).
  // Any other country code falls through and returns null (rejected).
  if (rawPhone.trim().startsWith('+1') && digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }

  return null; // not a valid US number — rejected
}

async function sendVerificationCode(phone, code) {
  if (MOCK_SMS) {
    console.log(`[MOCK SMS] Would send code ${code} to ${phone}`);
    return { mock: true };
  }

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

    if (isBlockedEmailDomain(email)) {
      return res.status(400).json({ error: 'Please use your company email address. Personal email providers (Gmail, Yahoo, Outlook, etc.) are not accepted for recruiter accounts.' });
    }

    const normalizedPhone = normalizePhoneToE164(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'PreCheckd currently only supports recruiters with a US phone number.' });
    }

    const existingEmail = await Recruiter.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const existingPhone = await Recruiter.findOne({ phone: normalizedPhone });
    if (existingPhone) {
      return res.status(400).json({ error: 'This phone number is already associated with a recruiter account.' });
    }

    const slug = await makeSlug(firstName, lastName);
    const emailToken = generateVerificationToken();

    // Company Domain check — leaves domainVerifiedAt null (Pending) unless the domain clears the age threshold
    const domain = email.split('@')[1];
    const domainCheck = await checkDomainAge(domain);
    const domainVerifiedAt = domainCheck.verified ? new Date() : null;
    const domainRegisteredYear = domainCheck.verified ? domainCheck.registeredYear : null;

    const recruiter = new Recruiter({
      firstName,
      lastName,
      nickname: nickname && nickname.trim() ? nickname.trim() : null,
      slug,
      email,
      phone: normalizedPhone,
      company: company || 'Not provided',
      isPhoneVerified: false,
      isIdentityVerified: false,
      isActive: false,
      emailVerifiedAt: null,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 48 * 60 * 60 * 1000, // 48 hours
      domainVerifiedAt: domainVerifiedAt,
      domainRegisteredYear: domainRegisteredYear
    });

    await recruiter.save();

    req.session.recruiterId = recruiter._id.toString();
    req.session.phone = normalizedPhone;

    const code = generateSixDigitCode();
    req.session.phoneVerificationCode = code;
    req.session.phoneVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    try {
      await sendVerificationCode(normalizedPhone, code);
      if (MOCK_SMS) {
        console.log(`SMS mocked for ${normalizedPhone} — use code ${code} or 123456`);
      } else {
        console.log('SMS sent successfully to', normalizedPhone);
      }
    } catch (smsError) {
      console.error('Failed to send SMS:', smsError);
      return res.status(500).json({ error: 'Failed to send verification code. Please check your phone number and try again.' });
    }

    // Fire the verification email in the background — never blocks signup
    sendVerificationEmail(email, firstName, emailToken).catch((emailError) => {
      console.error('Failed to send verification email:', emailError);
    });

    res.json({
      success: true,
      recruiterId: recruiter._id,
      message: MOCK_SMS
        ? `[TEST MODE] Verification code sent to ${normalizedPhone} (use 123456)`
        : `Verification code sent to ${normalizedPhone}`
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
      message: MOCK_SMS
        ? `[TEST MODE] Verification code resent to ${phone} (use 123456)`
        : `Verification code resent to ${phone}`
    });
  } catch (error) {
    console.error('Error resending code:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// Verify phone OTP (real, with mock bypass)
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

    const isMockBypass = MOCK_SMS && code === '123456';

    if (code !== expectedCode && !isMockBypass) {
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

// Verify email via clicked link (real)
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send('Missing verification token.');
    }

    const recruiter = await Recruiter.findOne({ emailVerificationToken: token });

    if (!recruiter) {
      return res.status(400).send('Invalid or already-used verification link.');
    }

    if (recruiter.emailVerificationExpires && Date.now() > recruiter.emailVerificationExpires) {
      return res.status(400).send('This verification link has expired. Please request a new one from your profile.');
    }

    recruiter.emailVerifiedAt = new Date();
    recruiter.emailVerificationToken = null;
    recruiter.emailVerificationExpires = null;
    await recruiter.save();

    res.send(`
      <div style="font-family: -apple-system, sans-serif; background:#1F363C; color:#F2F4F3; min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center;">
        <div>
          <h1 style="color:#4ADE80;">Email verified &#10003;</h1>
          <p>You're all set. This badge is now live on your PreCheckd profile.</p>
          <a href="/recruiter/${recruiter.slug}" style="color:#2ECC71;">View your profile</a>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('Error verifying email:', error);
    res.status(500).send('Something went wrong verifying your email.');
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