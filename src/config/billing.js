// Billing switch. Nothing about memberships is enforced until BILLING_ENABLED=true.
// Read at call time (not at load) so tests and a restart-free env flip behave the same way.
const GRACE_DAYS = 14;

function enabled() {
  return String(process.env.BILLING_ENABLED || '').toLowerCase() === 'true';
}

module.exports = { enabled, GRACE_DAYS };
