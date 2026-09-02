const express = require('express');
const verificationController = require('../controllers/verificationController');

const router = express.Router();

router.get('/', verificationController.showVerification);

module.exports = router;
