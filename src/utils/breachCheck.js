// Have I Been Pwned's breach-check API is free for a single email lookup —
// no API key required for this specific endpoint. Docs:
// https://haveibeenpwned.com/API/v3#BreachesForAccount
const HIBP_API_BASE = 'https://haveibeenpwned.com/api/v3/breachedaccount';

async function checkEmailBreaches(email) {
  const response = await fetch(`${HIBP_API_BASE}/${encodeURIComponent(email)}?truncateResponse=true`, {
    headers: {
      // HIBP requires a descriptive User-Agent identifying the calling app.
      'User-Agent': 'PreCheckd-EmailChecker',
    },
  });

  if (response.status === 404) {
    // 404 specifically means "not found in any breach" — not an error.
    return { breached: false, breachCount: 0, breachNames: [] };
  }

  if (response.status === 429) {
    throw new Error('Rate limited by breach-check service. Please try again in a moment.');
  }

  if (!response.ok) {
    throw new Error(`Breach-check service returned an unexpected error: ${response.status}`);
  }

  const data = await response.json();
  const breachNames = Array.isArray(data) ? data.map((b) => b.Name) : [];

  return {
    breached: breachNames.length > 0,
    breachCount: breachNames.length,
    breachNames,
  };
}

module.exports = { checkEmailBreaches };