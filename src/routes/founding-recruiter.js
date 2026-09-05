const express = require('express');
const router = express.Router();
const Recruiter = require('../models/Recruiter');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company } = req.body;
    const freeEmailDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
    const emailDomain = email.split('@')[1];
    if (freeEmailDomains.includes(emailDomain.toLowerCase())) {
      return res.status(400).json({ message: 'Please use your corporate email' });
    }

    const recruiter = await Recruiter.create({
      firstName, lastName, email, phone, company, status: 'pending_phone'
    });

    req.session.recruiterId = recruiter._id.toString();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
      await snsClient.send(new PublishCommand({
        Message: `Your PreCheckd verification code is: ${code}`,
        PhoneNumber: phone
      }));
      console.log(`[SNS] SMS sent: ${code}`);
    } catch (e) {
      console.log(`[DEV] Code: ${code}`);
    }

    recruiter.verifications.phone.code = code;
    recruiter.verifications.phone.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await recruiter.save();
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/verify-phone', async (req, res) => {
  try {
    const { code } = req.body;
    const recruiterId = req.session.recruiterId;
    if (!recruiterId) return res.status(401).json({ message: 'Session expired' });

    const recruiter = await Recruiter.findById(recruiterId);
    if (!recruiter) return res.status(404).json({ message: 'Not found' });

    // TEMPORARY: Accept any code for testing
    // TODO: Remove this when SMS is working
    
    recruiter.verifications.phone.confirmed = true;
    recruiter.verifications.phone.confirmedAt = new Date();
    recruiter.status = 'pending_identity';
    await recruiter.save();
    
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/resend-code', async (req, res) => {
  try {
    const recruiterId = req.session.recruiterId;
    if (!recruiterId) return res.status(401).json({ message: 'Session expired' });

    const recruiter = await Recruiter.findById(recruiterId);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    recruiter.verifications.phone.code = code;
    recruiter.verifications.phone.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await recruiter.save();
    console.log(`[DEV] Code: ${code}`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/create-identity-session', async (req, res) => {
  try {
    const recruiterId = req.session.recruiterId;
    if (!recruiterId) return res.status(401).json({ message: 'Session expired' });

    const recruiter = await Recruiter.findById(recruiterId);
    if (!recruiter) return res.status(404).json({ message: 'Not found' });

    // TEMPORARY: Mark as active immediately (Stripe not working yet)
    // TODO: Remove this when Stripe Identity is properly working
    recruiter.verifications.identity.confirmed = true;
    recruiter.verifications.identity.confirmedAt = new Date();
    recruiter.status = 'active';
    await recruiter.save();

    console.log(`[Identity] Recruiter activated: ${recruiter.email}`);
    
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/verify-identity-complete', async (req, res) => {
  try {
    const recruiterId = req.session.recruiterId;
    if (!recruiterId) return res.status(401).json({ message: 'Session expired' });

    const recruiter = await Recruiter.findById(recruiterId);
    if (!recruiter) return res.status(404).json({ message: 'Not found' });

    recruiter.verifications.identity.confirmed = true;
    recruiter.verifications.identity.confirmedAt = new Date();
    recruiter.status = 'active';
    await recruiter.save();

    console.log(`[Identity] Verification completed for ${recruiter.email}`);
    
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;