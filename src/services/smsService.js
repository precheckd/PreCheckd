const axios = require('axios');

const BASE_URL = process.env.MESSAGE_CENTRAL_BASE_URL;
const CUSTOMER_ID = process.env.MESSAGE_CENTRAL_CUSTOMER_ID;
const AUTH_TOKEN = process.env.MESSAGE_CENTRAL_AUTH_TOKEN;

// Store the verification token (changes per request)
let verificationAuthToken = null;

// Generate a new auth token
async function getAuthToken() {
  try {
    const response = await axios.get(
      `${BASE_URL}auth/v1/authentication/token`,
      {
        params: {
          customerId: CUSTOMER_ID,
          key: AUTH_TOKEN,
          scope: 'NEW'
        },
        headers: {
          'accept': '*/*'
        }
      }
    );

    if (response.data.data && response.data.data.authToken) {
      verificationAuthToken = response.data.data.authToken;
      return verificationAuthToken;
    } else {
      throw new Error('No auth token in response');
    }
  } catch (error) {
    console.error('Error getting auth token:', error.response?.data || error.message);
    throw error;
  }
}

// Generate a random 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP via Message Central
async function sendOTP(phoneNumber) {
  try {
    // Get fresh auth token
    const authToken = await getAuthToken();
    
    // Remove any non-digits and format
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Message Central expects the phone number in the request
    const response = await axios.post(
      `${BASE_URL}verification/v3/send`,
      null,  // No body
      {
        params: {
          customerId: CUSTOMER_ID,
          mobileNumber: cleanPhone,
          flowType: 'SMS',
          otpLength: 6,
          countryCode: '1'  // US country code
        },
        headers: {
          'authToken': authToken,
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
    // Use the stored auth token
    if (!verificationAuthToken) {
      verificationAuthToken = await getAuthToken();
    }

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
          'authToken': verificationAuthToken,
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