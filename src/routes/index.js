const express = require('express');
const founderRoutes = require('./founderRoutes');
const smsRoutes = require('./smsRoutes');
const paymentRoutes = require('./paymentRoutes');
const verificationRoutes = require('./verificationRoutes');

// Note: webhookRoutes is mounted separately in app.js, ahead of the JSON
// body parser, so it is intentionally not included in this router.
const router = express.Router();

router.use('/founding-recruiter/sms', smsRoutes);
router.use('/founding-recruiter/payment', paymentRoutes);
router.use('/founding-recruiter/success', verificationRoutes);
router.use('/founding-recruiter', founderRoutes);

module.exports = router;
