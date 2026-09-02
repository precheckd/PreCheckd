module.exports = {
  appToken: process.env.SUMSUB_APP_TOKEN,
  secretKey: process.env.SUMSUB_SECRET_KEY,
  baseUrl: process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com',
  levelName: process.env.SUMSUB_LEVEL_NAME || 'founding-recruiter-kyc',
  webhookSecret: process.env.SUMSUB_WEBHOOK_SECRET,
};
