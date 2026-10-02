const required = [
  'MONGODB_URI',
  'STRIPE_SECRET_KEY',
  'SUMSUB_APP_TOKEN',
  'SUMSUB_SECRET_KEY',
];

function assertEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (missing.length) {
    console.warn(`Warning: missing environment variables: ${missing.join(', ')}`);
  }
}

module.exports = { assertEnv };
