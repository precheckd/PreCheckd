const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PinpointSMSVoiceV2Client, SendNotifyTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const ConnectionRequest = require('../models/ConnectionRequest');
const {
  sendCandidateVerificationCode,
  sendCandidateLoginCode,
  generateSixDigitCode
} = require('../services/emailService');

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

function makeSlug(firstName, lastName) {
  const base = `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

function normalizePhoneToE164(rawPhone) {
  const digitsOnly = rawPhone.replace(/\D/g, '');

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }
  if (rawPhone.trim().startsWith('+')) {
    return rawPhone.trim();
  }
  return null;
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

// Step 0: Check whether this email belongs to an existing candidate.
// New candidates get routed to signup; existing ones get a login code.
router.post('/check-email', async (req, res) => {
  try {
    const { email, recruiterSlug } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (recruiterSlug) {
      req.session.candidateRecruiterSlug = recruiterSlug;
    }

    const candidate = await Candidate.findOne({ email });

    if (!candidate) {
      return res.json({ exists: false });
    }

    const code = generateSixDigitCode();
    candidate.loginToken = code;
    candidate.loginTokenExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await candidate.save();

    req.session.candidatePendingLoginId = candidate._id.toString();

    sendCandidateLoginCode(candidate.email, candidate.firstName, code).catch((err) => {
      console.error('Failed to send candidate login code:', err);
    });

    res.json({ exists: true, firstName: candidate.firstName });
  } catch (error) {
    console.error('Error checking candidate email:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Verify the returning-candidate login code
router.post('/login-verify', async (req, res) => {
  try {
    const { code } = req.body;
    const candidateId = req.session.candidatePendingLoginId;

    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }

    if (!candidateId) {
      return res.status(400).json({ error: 'No login attempt in progress. Please start over.' });
    }

    const candidate = await Candidate.findById(candidateId);

    if (!candidate || !candidate.loginToken || !candidate.loginTokenExpires) {
      return res.status(400).json({ error: 'No code on file. Please request a new one.' });
    }

    if (Date.now() > candidate.loginTokenExpires) {
      return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    }

    if (code !== candidate.loginToken) {
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }

    candidate.loginToken = null;
    candidate.loginTokenExpires = null;
    await candidate.save();

    req.session.candidateId = candidate._id.toString();
    delete req.session.candidatePendingLoginId;

    res.json({
      success: true,
      recruiterSlug: req.session.candidateRecruiterSlug || null
    });
  } catch (error) {
    console.error('Error verifying candidate login code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Step 1: New candidate signup
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedPhone = normalizePhoneToE164(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Please enter a valid US phone number.' });
    }

    const existing = await Candidate.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const slug = makeSlug(firstName, lastName);

    const candidate = new Candidate({
      firstName,
      lastName,
      slug,
      email,
      phone: normalizedPhone,
      emailVerifiedAt: null
    });

    await candidate.save();

    req.session.candidateId = candidate._id.toString();
    req.session.candidatePhone = normalizedPhone;

    const code = generateSixDigitCode();
    req.session.candidatePhoneVerificationCode = code;
    req.session.candidatePhoneVerificationExpires = Date.now() + 10 * 60 * 1000;

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

    res.json({
      success: true,
      candidateId: candidate._id,
      message: MOCK_SMS
        ? `[TEST MODE] Verification code sent to ${normalizedPhone} (use 123456)`
        : `Verification code sent to ${normalizedPhone}`
    });
  } catch (error) {
    console.error('Error during candidate signup:', error);
    res.status(500).json({ error: 'Failed to complete signup' });
  }
});

// Resend SMS code
router.post('/resend-code', async (req, res) => {
  try {
    const phone = req.session.candidatePhone;

    if (!phone) {
      return res.status(400).json({ error: 'No phone on file' });
    }

    const code = generateSixDigitCode();
    req.session.candidatePhoneVerificationCode = code;
    req.session.candidatePhoneVerificationExpires = Date.now() + 10 * 60 * 1000;

    await sendVerificationCode(phone, code);

    res.json({
      success: true,
      message: MOCK_SMS
        ? `[TEST MODE] Verification code resent to ${phone} (use 123456)`
        : `Verification code resent to ${phone}`
    });
  } catch (error) {
    console.error('Error resending candidate code:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// Step 2: Verify phone OTP, then kick off email code
router.post('/verify-phone', async (req, res) => {
  try {
    const { code } = req.body;
    const candidateId = req.session.candidateId;
    const expectedCode = req.session.candidatePhoneVerificationCode;
    const expiresAt = req.session.candidatePhoneVerificationExpires;

    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }

    if (!candidateId) {
      return res.status(400).json({ error: 'No active candidate session' });
    }

    if (!expectedCode || !expiresAt) {
      return res.status(400).json({ success: false, message: 'No verification code on file. Please request a new one.' });
    }

    if (Date.now() > expiresAt) {
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new one.' });
    }

    const isMockBypass = MOCK_SMS && code === '123456';

    if (code !== expectedCode && !isMockBypass) {
      return res.status(400).json({ success: false, message: 'Incorrect verification code. Please try again.' });
    }

    const candidate = await Candidate.findByIdAndUpdate(candidateId, {
      isPhoneVerified: true,
      phoneVerifiedAt: new Date()
    }, { new: true });

    delete req.session.candidatePhoneVerificationCode;
    delete req.session.candidatePhoneVerificationExpires;

    // Kick off email verification code immediately
    const emailCode = generateSixDigitCode();
    candidate.emailVerificationToken = emailCode;
    candidate.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
    await candidate.save();

    sendCandidateVerificationCode(candidate.email, candidate.firstName, emailCode).catch((err) => {
      console.error('Failed to send candidate email code:', err);
    });

    res.json({ success: true, message: 'Phone verified successfully' });
  } catch (error) {
    console.error('Error verifying candidate phone OTP:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Resend email code
router.post('/resend-email-code', async (req, res) => {
  try {
    const candidateId = req.session.candidateId;
    if (!candidateId) {
      return res.status(400).json({ error: 'No active candidate session' });
    }

    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const emailCode = generateSixDigitCode();
    candidate.emailVerificationToken = emailCode;
    candidate.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
    await candidate.save();

    await sendCandidateVerificationCode(candidate.email, candidate.firstName, emailCode);

    res.json({ success: true, message: 'Verification code resent to your email' });
  } catch (error) {
    console.error('Error resending candidate email code:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// Step 3: Verify email code
router.post('/verify-email-code', async (req, res) => {
  try {
    const { code } = req.body;
    const candidateId = req.session.candidateId;

    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }

    if (!candidateId) {
      return res.status(400).json({ error: 'No active candidate session' });
    }

    const candidate = await Candidate.findById(candidateId);

    if (!candidate || !candidate.emailVerificationToken || !candidate.emailVerificationExpires) {
      return res.status(400).json({ error: 'No code on file. Please request a new one.' });
    }

    if (Date.now() > candidate.emailVerificationExpires) {
      return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    }

    const isMockBypass = MOCK_SMS && code === '123456';

    if (code !== candidate.emailVerificationToken && !isMockBypass) {
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }

    candidate.emailVerifiedAt = new Date();
    candidate.emailVerificationToken = null;
    candidate.emailVerificationExpires = null;
    await candidate.save();

    res.json({
      success: true,
      recruiterSlug: req.session.candidateRecruiterSlug || null
    });
  } catch (error) {
    console.error('Error verifying candidate email code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Send a connection request to the recruiter remembered in this session
router.post('/connect', async (req, res) => {
  try {
    const candidateId = req.session.candidateId;
    const recruiterSlug = req.session.candidateRecruiterSlug;
    const { note } = req.body;

    if (!candidateId) {
      return res.status(400).json({ error: 'You must be logged in to send a connection request.' });
    }

    if (!recruiterSlug) {
      return res.status(400).json({ error: 'No recruiter selected.' });
    }

    const candidate = await Candidate.findById(candidateId);
    if (!candidate || !candidate.isPhoneVerified || !candidate.emailVerifiedAt) {
      return res.status(403).json({ error: 'Please complete verification before contacting recruiters.' });
    }

    const recruiter = await Recruiter.findOne({ slug: recruiterSlug, isActive: true });
    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found.' });
    }

    const existingRequest = await ConnectionRequest.findOne({
      candidateId: candidate._id,
      recruiterId: recruiter._id,
      status: { $in: ['pending', 'accepted'] }
    });

    if (existingRequest) {
      return res.json({
        success: true,
        alreadySent: true,
        recruiterName: `${recruiter.firstName} ${recruiter.lastName}`
      });
    }

    const trimmedNote = note && note.trim() ? note.trim().slice(0, 500) : null;

    await ConnectionRequest.create({
      candidateId: candidate._id,
      recruiterId: recruiter._id,
      note: trimmedNote
    });

    delete req.session.candidateRecruiterSlug;

    res.json({
      success: true,
      alreadySent: false,
      recruiterName: `${recruiter.firstName} ${recruiter.lastName}`
    });
  } catch (error) {
    console.error('Error creating connection request:', error);
    res.status(500).json({ error: 'Failed to send connection request' });
  }
});

module.exports = router;