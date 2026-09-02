const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const founderController = require('../controllers/founderController');

const router = express.Router();

router.get('/', founderController.showSignupForm);

router.post(
  '/',
  [
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty(),
    body('email').isEmail(),
    body('phone').trim().notEmpty(),
  ],
  validateRequest,
  founderController.createSignup
);

module.exports = router;
