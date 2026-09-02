const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const smsController = require('../controllers/smsController');

const router = express.Router();

router.post(
  '/send-code',
  [body('recruiterId').notEmpty()],
  validateRequest,
  smsController.sendCode
);

router.post(
  '/verify-code',
  [body('recruiterId').notEmpty(), body('code').trim().notEmpty()],
  validateRequest,
  smsController.verifyCode
);

module.exports = router;
