const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const { PinpointSMSVoiceV2Client, SendNotifyTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const ConnectionRequest = require('../models/ConnectionRequest');
const {
  sendCandidateLoginCode,
  sendCandidateVerificationLink,
  generateVerificationToken,
  generateSixDigitCode
} = require('../services/emailService');
const { uploadResume } = require('../utils/s3Upload');
const { parseResume } = require('../utils/resumeParser');

const MOCK_SMS = process.env.MOCK_SMS === 'true';
const MOCK_IDENTITY = process.env.MOCK_IDENTITY === 'true';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const smsClient = new PinpointSMSVoiceV2Client({
  region: process.env.AWS_SMS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_SMS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SMS_SECRET_ACCESS_KEY,
  },
});

const NOTIFY_CONFIGURATION_ID = process.env.AWS_NOTIFY_CONFIGURATION_ID;
const NOTIFY_TEMPLATE_ID = process.env.AWS_NOTIFY_TEMPLATE_ID;

async function makeSlug(firstName, lastName) {
  const base = `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const existing = await Candidate.findOne({ slug: base });
  if (!existing) {
    return base;
  }

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

async function processResumeInBackground(candidateId, file) {
  try {
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) return;

    const resumeUrl = await uploadResume(candidateId, file);
    candidate.resumeUrl = resumeUrl;
    await candidate.save();

    const parsed = await parseResume(file);

    candidate.bio = parsed.bio;
    candidate.workHistory = parsed.workHistory;
    candidate.educationHistory = parsed.educationHistory;
    candidate.certifications = parsed.certifications;
    candidate.resumeParsingStatus = 'complete';
    await candidate.save();
  } catch (error) {
    console.error('Resume parsing failed:', error);
    try {
      await Candidate.findByIdAndUpdate(candidateId, { resumeParsingStatus: 'failed' });
    } catch (updateError) {
      console.error('Failed to mark resume parsing as failed:', updateError);
    }
  }
}

// Log out — candidates get sent back to their own entry point, not the
// recruiter login page.
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/candidate-signup');
  });
});

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
    candidate.loginTokenExpires = Date.now() + 10 * 60 * 1000;
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
      recruiterSlug: req.session.candidateRecruiterSlug || null,
      isFullyVerified: Boolean(candidate.isPhoneVerified && candidate.isIdentityVerified),
      slug: candidate.slug
    });
  } catch (error) {
    console.error('Error verifying candidate login code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

router.post('/signup', upload.single('resume'), async (req, res) => {
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

    const slug = await makeSlug(firstName, lastName);
    const emailToken = generateVerificationToken();

    const candidate = new Candidate({
      firstName,
      lastName,
      slug,
      email,
      phone: normalizedPhone,
      emailVerifiedAt: null,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 48 * 60 * 60 * 1000,
      resumeParsingStatus: req.file ? 'pending' : 'none'
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

    sendCandidateVerificationLink(candidate.email, candidate.firstName, emailToken).catch((err) => {
      console.error('Failed to send candidate verification email:', err);
    });

    if (req.file) {
      processResumeInBackground(candidate._id.toString(), req.file);
    }

    res.json({
      success: true,
      candidateId: candidate._id,
      hasResume: Boolean(req.file),
      message: MOCK_SMS
        ? `[TEST MODE] Verification code sent to ${normalizedPhone} (use 123456)`
        : `Verification code sent to ${normalizedPhone}`
    });
  } catch (error) {
    console.error('Error during candidate signup:', error);
    res.status(500).json({ error: 'Failed to complete signup' });
  }
});

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

    await Candidate.findByIdAndUpdate(candidateId, {
      isPhoneVerified: true,
      phoneVerifiedAt: new Date()
    });

    delete req.session.candidatePhoneVerificationCode;
    delete req.session.candidatePhoneVerificationExpires;

    res.json({ success: true, message: 'Phone verified successfully' });
  } catch (error) {
    console.error('Error verifying candidate phone OTP:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

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
      return res.status(400).send('This verification link has expired. Please request a new one from your profile.');
    }

    candidate.emailVerifiedAt = new Date();
    candidate.emailVerificationToken = null;
    candidate.emailVerificationExpires = null;
    await candidate.save();

    req.session.candidateId = candidate._id.toString();
    res.redirect(`/candidate/${candidate.slug}`);
  } catch (error) {
    console.error('Error verifying candidate email:', error);
    res.status(500).send('Something went wrong verifying your email.');
  }
});

router.get('/resume-status', async (req, res) => {
  try {
    const candidateId = req.session.candidateId;
    if (!candidateId) {
      return res.status(400).json({ error: 'No active candidate session' });
    }

    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json({
      status: candidate.resumeParsingStatus,
      bio: candidate.bio,
      workHistory: candidate.workHistory,
      educationHistory: candidate.educationHistory,
      certifications: candidate.certifications
    });
  } catch (error) {
    console.error('Error checking resume status:', error);
    res.status(500).json({ error: 'Failed to check resume status' });
  }
});

router.post('/save-profile-details', async (req, res) => {
  try {
    const candidateId = req.session.candidateId;
    if (!candidateId) {
      return res.status(400).json({ error: 'No active candidate session' });
    }

    const { bio, workHistory, educationHistory, certifications } = req.body;

    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    candidate.bio = bio && bio.trim() ? bio.trim().slice(0, 1000) : null;
    candidate.workHistory = Array.isArray(workHistory) ? workHistory : [];
    candidate.educationHistory = Array.isArray(educationHistory) ? educationHistory : [];

    if (Array.isArray(certifications)) {
      const existingByName = new Map(
        (candidate.certifications || []).map((c) => [c.name.toLowerCase(), c])
      );

      candidate.certifications = certifications
        .filter((c) => c && c.name && c.name.trim())
        .map((c) => {
          const existing = existingByName.get(c.name.trim().toLowerCase());
          const credentialId = c.credentialId && c.credentialId.trim() ? c.credentialId.trim() : null;

          if (existing && existing.credentialId === credentialId) {
            return existing;
          }

          return {
            name: c.name.trim(),
            credentialId,
            verified: false,
            verifiedAt: null
          };
        });
    }

    await candidate.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving candidate profile details:', error);
    res.status(500).json({ error: 'Failed to save profile details' });
  }
});

router.post('/create-identity-session', async (req, res) => {
  try {
    const candidateId = req.session.candidateId;

    if (!candidateId) {
      return res.status(400).json({ error: 'No active candidate session' });
    }

    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    if (MOCK_IDENTITY) {
      console.log(`[MOCK IDENTITY] Skipping real Stripe session for ${candidate.email}`);
      return res.json({
        success: true,
        mock: true,
        clientSecret: null,
        sessionId: 'mock-session'
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const stripe = require('stripe')(stripeKey);

    const verificationSession = await stripe.identity.verificationSessions.create({
      type: 'document',
      options: {
        document: {
          require_matching_selfie: true
        }
      },
      metadata: {
        candidateId: candidateId,
        email: candidate.email,
        name: `${candidate.firstName} ${candidate.lastName}`
      }
    });

    candidate.stripeVerificationSessionId = verificationSession.id;
    await candidate.save();

    res.json({
      success: true,
      clientSecret: verificationSession.client_secret,
      sessionId: verificationSession.id
    });
  } catch (error) {
    console.error('Error creating candidate identity session:', error);
    res.status(500).json({ error: 'Failed to create identity verification session' });
  }
});

router.post('/verify-identity-session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const candidateId = req.session.candidateId;

    if (!candidateId) {
      return res.status(400).json({ error: 'Missing candidate session' });
    }

    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    if (MOCK_IDENTITY || sessionId === 'mock-session') {
      console.log(`[MOCK IDENTITY] Marking ${candidate.email} as identity-verified without a real Stripe check`);
      candidate.isIdentityVerified = true;
      candidate.identityVerifiedAt = new Date();
      candidate.facialRecognitionVerifiedAt = new Date();
      candidate.status = 'candidate';
      await candidate.save();

      return res.json({
        success: true,
        slug: candidate.slug,
        resumeParsingStatus: candidate.resumeParsingStatus
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const stripe = require('stripe')(stripeKey);

    const verificationSession = await stripe.identity.verificationSessions.retrieve(sessionId, {
      expand: ['verified_outputs']
    });

    if (verificationSession.status === 'verified') {
      const rawDocFirstName = (verificationSession.verified_outputs?.first_name || '').trim();
      const docFirstName = rawDocFirstName.split(/\s+/)[0] || '';
      const docLastName = (verificationSession.verified_outputs?.last_name || '').trim();

      if (docFirstName && docLastName) {
        candidate.firstName = docFirstName;
        candidate.lastName = docLastName;
      }

      candidate.isIdentityVerified = true;
      candidate.identityVerifiedAt = new Date();
      candidate.facialRecognitionVerifiedAt = new Date();
      candidate.status = 'candidate';
      await candidate.save();

      res.json({
        success: true,
        slug: candidate.slug,
        resumeParsingStatus: candidate.resumeParsingStatus
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
    console.error('Error verifying candidate identity session:', error);
    res.status(500).json({ error: 'Failed to verify identity session' });
  }
});

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
    if (!candidate || !candidate.isPhoneVerified || !candidate.isIdentityVerified) {
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