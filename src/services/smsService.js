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
    // Remove any non-digits
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    const response = await axios.post(
      `${BASE_URL}verification/v3/send`,
      null,  // No body
      {
        params: {
          customerId: CUSTOMER_ID,
          mobileNumber: cleanPhone,
          flowType: 'SMS',
          otpLength: 6,
          countryCode: '1'
        },
        headers: {
          'authToken': AUTH_TOKEN,
          'accept': '*/*'
        }
      }
    );

    if (response.data.data && response.data.data.verificationId) {
      return {
        success: true,
        requestId: response.data.data.verificationId,
        message: 'OTP sent successfully'
      };
    } else {
      return {
        success: false,
        error: response.data.message || 'Failed to send OTP'
      };
    }
  } catch (error) {
    console.error('Error sending OTP:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to send OTP'
    };
  }
}

// Validate OTP
async function validateOTP(verificationId, otp) {
  try {
    const response = await axios.post(
      `${BASE_URL}verification/v3/validateOtp`,
      null,  // No body
      {
        params: {
          verificationId: verificationId,
          code: otp,
          flowType: 'SMS'
        },
        headers: {
          'authToken': AUTH_TOKEN,
          'accept': '*/*'
        }
      }
    );

    if (response.data.responseCode === 200 || response.data.data?.verificationStatus === 'VERIFICATION_COMPLETED') {
      return {
        success: true,
        message: 'OTP validated successfully'
      };
    } else {
      return {
        success: false,
        error: response.data.message || 'Invalid OTP'
      };
    }
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