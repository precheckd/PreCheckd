const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PinpointSMSVoiceV2Client, SendNotifyTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');
const Candidate = require('../models/Candidate');
const { sendCandidateVerificationEmail, generateVerificationToken } = require('../services/emailService');

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

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
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

function isValidLinkedInUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname.includes('linkedin.com');
  } catch {
    return false;
  }
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

// Step 1: Candidate signup
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, linkedinUrl } = req.body;

    if (!firstName || !lastName || !email || !phone || !linkedinUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!isValidLinkedInUrl(linkedinUrl)) {
      return res.status(400).json({ error: 'Please enter a valid LinkedIn profile URL.' });
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
    const emailToken = generateVerificationToken();

    const candidate = new Candidate({
      firstName,
      lastName,
      slug,
      email,
      phone: normalizedPhone,
      linkedinUrl: linkedinUrl.trim(),
      emailVerifiedAt: null,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 48 * 60 * 60 * 1000 // 48 hours
    });

    await candidate.save();

    req.session.candidateId = candidate._id.toString();
    req.session.candidatePhone = normalizedPhone;

    const code = generateSixDigitCode();
    req.session.candidatePhoneVerificationCode = code;
    req.session.candidatePhoneVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

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

    sendCandidateVerificationEmail(email, firstName, emailToken).catch((emailError) => {
      console.error('Failed to send candidate verification email:', emailError);
    });

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

// Verify phone OTP
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

    const candidate = await Candidate.findByIdAndUpdate(candidateId, {
      isPhoneVerified: true,
      phoneVerifiedAt: new Date()
    }, { new: true });

    req.session.candidatePhoneVerified = true;
    delete req.session.candidatePhoneVerificationCode;
    delete req.session.candidatePhoneVerificationExpires;

    res.json({
      success: true,
      message: 'Phone verified successfully',
      slug: candidate.slug
    });
  } catch (error) {
    console.error('Error verifying candidate phone OTP:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Verify email via clicked link
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send('Missing verification token.');
    }

    const candidate = await Candidate.findOne({ emailVerificationToken: token });

    if (!candidate) {
      return res.status(400).send('Invalid or already-used verification link.');
    }

    if (candidate.emailVerificationExpires && Date.now() > candidate.emailVerificationExpires) {
      return res.status(400).send('This verification link has expired. Please request a new one.');
    }

    candidate.emailVerifiedAt = new Date();
    candidate.emailVerificationToken = null;
    candidate.emailVerificationExpires = null;
    await candidate.save();

    res.send(`
      <div style="font-family: -apple-system, sans-serif; background:#1F363C; color:#F2F4F3; min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center;">
        <div>
          <h1 style="color:#4ADE80;">Email verified &#10003;</h1>
          <p>You're all set. You can now browse and contact verified recruiters on PreCheckd.</p>
          <a href="/recruiter-search" style="color:#2ECC71;">Browse Recruiters</a>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('Error verifying candidate email:', error);
    res.status(500).send('Something went wrong verifying your email.');
  }
});

module.exports = router;