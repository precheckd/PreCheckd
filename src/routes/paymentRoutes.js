const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const paymentController = require('../controllers/paymentController');

const router = express.Router();

router.post(
  '/checkout',
  [body('recruiterId').notEmpty()],
  validateRequest,
  paymentController.createCheckoutSession
);

module.exports = router;
