const express = require('express');
const paymentController = require('../controllers/paymentController');
const verificationController = require('../controllers/verificationController');

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

module.exports = router;
