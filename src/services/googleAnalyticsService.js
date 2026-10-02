const { BetaAnalyticsDataClient } = require('@google-analytics/data');

// All three are required for this to actually run — until Kent finishes
// the GA4 + service-account setup, this stays unconfigured and the
// dashboard shows "not connected yet" instead of a broken chart.
const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID;
const GA_CLIENT_EMAIL = process.env.GA_CLIENT_EMAIL;
const GA_PRIVATE_KEY = process.env.GA_PRIVATE_KEY;

const isConfigured = Boolean(GA_PROPERTY_ID && GA_CLIENT_EMAIL && GA_PRIVATE_KEY);

let client = null;
function getClient() {
  if (!client) {
    client = new BetaAnalyticsDataClient({
      credentials: {
        client_email: GA_CLIENT_EMAIL,
        // Render (like most host env-var UIs) stores a single-line value,
        // so a real multi-line PEM key has to have its newlines escaped as
        // \n when it's pasted in — unescape them back before use.
        private_key: GA_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
    });
  }
  return client;
}

// Returns an array of { _id: 'YYYY-MM-DD', count } rows (same shape the
// Mongo signup aggregations use, so the route can treat them uniformly),
// or null if GA4 isn't configured yet. Never throws for "not configured" —
// that's an expected, temporary state, not an error.
async function getDailyPageViews(days) {
  if (!isConfigured) {
    return null;
  }

  const [response] = await getClient().runReport({
    property: `properties/${GA_PROPERTY_ID}`,
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'screenPageViews' }],
  });

  return (response.rows || []).map((row) => {
    const raw = row.dimensionValues[0].value; // GA4 returns dates as YYYYMMDD
    const isoDate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return { _id: isoDate, count: Number(row.metricValues[0].value) };
  });
}

module.exports = { getDailyPageViews, isConfigured };
