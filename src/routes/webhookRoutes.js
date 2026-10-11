const express = require('express');
const paymentController = require('../controllers/paymentController');
const verificationController = require('../controllers/verificationController');
const inboundEmail = require('../services/inboundEmail');

const router = express.Router();

// Raw body required for signature verification on both providers
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  paymentController.handleWebhook
);

router.post(
  '/sumsub',
  express.raw({ type: 'application/json' }),
  verificationController.handleWebhook
);

// Inbound email from Resend (svix-signed; raw body required)
router.post(
  '/resend-inbound',
  express.raw({ type: 'application/json' }),
  inboundEmail.handleWebhook
);

module.exports = router;
