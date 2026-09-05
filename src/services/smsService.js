const axios = require('axios');

const BASE_URL = process.env.MESSAGE_CENTRAL_BASE_URL;
const CUSTOMER_ID = process.env.MESSAGE_CENTRAL_CUSTOMER_ID;
const AUTH_TOKEN = process.env.MESSAGE_CENTRAL_AUTH_TOKEN;

// Generate a random 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP via Message Central
async function sendOTP(phoneNumber) {
  try {
    const otp = generateOTP();
    
    // Message Central OTP endpoint
    const response = await axios.post(
      `${BASE_URL}verification/v3/send`,
      {
        customerId: CUSTOMER_ID,
        phoneNumber: phoneNumber,
        otp: otp,
        otpLength: 6
      },
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      otp: otp,
      requestId: response.data.requestId,
      message: 'OTP sent successfully'
    };
  } catch (error) {
    console.error('Error sending OTP:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to send OTP'
    };
  }
}

// Validate OTP
async function validateOTP(requestId, otp) {
  try {
    const response = await axios.post(
      `${BASE_URL}verification/v3/validateOtp`,
      {
        customerId: CUSTOMER_ID,
        requestId: requestId,
        otp: otp
      },
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: response.data.isValid || false,
      message: response.data.message || 'Validation complete'
    };
  } catch (error) {
    console.error('Error validating OTP:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to validate OTP'
    };
  }
}

module.exports = {
  sendOTP,
  validateOTP,
  generateOTP
};