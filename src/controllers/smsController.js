const Recruiter = require('../models/Recruiter');
const twilioService = require('../services/twilioService');

async function sendCode(req, res, next) {
  try {
    const recruiter = await Recruiter.findById(req.body.recruiterId);
    if (!recruiter) return res.status(404).json({ error: 'Recruiter not found' });

    await twilioService.startVerification(recruiter.phone);
    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
}

async function verifyCode(req, res, next) {
  try {
    const recruiter = await Recruiter.findById(req.body.recruiterId);
    if (!recruiter) return res.status(404).json({ error: 'Recruiter not found' });

    const check = await twilioService.checkVerification(recruiter.phone, req.body.code);
    if (check.status !== 'approved') {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    recruiter.phoneVerified = true;
    await recruiter.save();
    res.json({ verified: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendCode, verifyCode };
