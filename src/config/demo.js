// Demo mode: demo.precheckd.com runs this same code as its own Render service, pointed at its own database
// (MONGODB_DB_NAME must contain "demo"). DEMO_MODE=true makes the site read-only sample data:
//   - every request that would change something is refused (middleware/demoMode.js), except the few the demo allows
//   - email, SMS, ID checks and billing are forced off here, even if real keys were copied into the environment
//   - the background jobs do not start, and a nightly job wipes and reseeds the database (scripts/demo-reset.js)
const enabled = () => process.env.DEMO_MODE === 'true';

// Run before anything reads these (they are read when a service file first loads).
function lockDown() {
  if (!enabled()) return;
  Object.assign(process.env, {
    MOCK_EMAIL: 'true', MOCK_SMS: 'true', MOCK_IDENTITY: 'true', DISABLE_JOBS: 'true',
    RESEND_API_KEY: 're_demo_disabled', STRIPE_SECRET_KEY: 'sk_test_demo_disabled', STRIPE_PUBLISHABLE_KEY: 'pk_test_demo_disabled',
    SUMSUB_APP_TOKEN: 'demo-disabled', SUMSUB_SECRET_KEY: 'demo-disabled',
  });
  for (const k of ['BILLING_ENABLED', 'OUTREACH_ENABLED', 'CODERBYTE_API_KEY', 'ANTHROPIC_API_KEY', 'GA_MEASUREMENT_ID',
    'MESSAGE_CENTRAL_AUTH_TOKEN', 'STRIPE_WEBHOOK_SECRET', 'SUMSUB_WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET', 'INTERNAL_ADMIN_SECRET']) delete process.env[k];
}

const signupUrl = () => process.env.DEMO_SIGNUP_URL || 'https://precheckd.com/founding-recruiter';
const candidateSignupUrl = () => process.env.DEMO_CANDIDATE_SIGNUP_URL || 'https://precheckd.com/candidate-signup';

// Logins for the two shared demo accounts (created by the seed).
const RECRUITER_EMAIL = 'recruiter@demo.invalid';
const CANDIDATE_EMAIL = 'candidate@demo.invalid';

module.exports = { enabled, lockDown, signupUrl, candidateSignupUrl, RECRUITER_EMAIL, CANDIDATE_EMAIL };
