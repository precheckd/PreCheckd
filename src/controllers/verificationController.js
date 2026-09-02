const Recruiter = require('../models/Recruiter');
const sumsubService = require('../services/sumsubService');

async function showVerification(req, res, next) {
  try {
    const recruiter = await Recruiter.findById(req.query.recruiterId);
    if (!recruiter) return res.status(404).send('Recruiter not found');

    if (recruiter.paymentStatus !== 'paid') {
      return res.redirect(`/founding-recruiter?recruiterId=${recruiter._id}`);
    }

    if (!recruiter.sumsubApplicantId) {
      const applicant = await sumsubService.createApplicant(recruiter._id.toString());
      recruiter.sumsubApplicantId = applicant.id;
      recruiter.verificationStatus = 'pending';
      await recruiter.save();
    }

    const accessToken = await sumsubService.generateAccessToken(recruiter._id.toString());

    res.render('verification', {
      title: 'Identity Verification',
      recruiterId: recruiter._id,
      sumsubAccessToken: accessToken.token,
    });
  } catch (err) {
    next(err);
  }
}

async function handleWebhook(req, res, next) {
  try {
    const signature = req.headers['x-payload-digest'];
    const isValid = sumsubService.verifyWebhookSignature(req.body, signature);
    if (!isValid) return res.status(401).send('Invalid signature');

    const payload = JSON.parse(req.body.toString('utf8'));
    const { applicantId, reviewStatus, reviewResult } = payload;

    if (payload.type === 'applicantReviewed' && reviewStatus === 'completed') {
      const status = reviewResult && reviewResult.reviewAnswer === 'GREEN' ? 'approved' : 'rejected';
      const recruiter = await Recruiter.findOneAndUpdate(
        { sumsubApplicantId: applicantId },
        { verificationStatus: status }
      );
      if (recruiter && status === 'approved' && recruiter.paymentStatus === 'paid') {
        recruiter.status = 'active';
        await recruiter.save();
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { showVerification, handleWebhook };
