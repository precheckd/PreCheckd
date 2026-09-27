// Verifies candidate certifications against Credly's public badge-wallet
// JSON endpoint — no authentication, no scraping, no headless browser
// needed. Confirmed working Sept 26, 2026: credly.com/users/<username>/badges.json
// returns the user's full public badge wallet as structured JSON, even when
// fetched fully anonymously.

const CREDLY_BASE = 'https://www.credly.com/users';

// Normalizes a certification name for loose comparison — same spirit as
// the original Python agent's approach, lowercased and stripped of
// punctuation/spacing differences so "AWS Cloud Practitioner" and
// "AWS Certified Cloud Practitioner" have a chance to match sensibly.
function normalizeCertName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/certified|certification|certificate/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Fetches a Credly user's full public badge wallet. Returns an array of
// badges (empty array if the profile has no public badges), or throws if
// the username doesn't resolve to a real profile at all.
async function fetchCredlyBadges(username) {
  const url = `${CREDLY_BASE}/${encodeURIComponent(username)}/badges.json`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'PreCheckd-CertVerification' },
  });

  if (!response.ok) {
    throw new Error(`Credly profile not found or not public (status ${response.status})`);
  }

  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

function getBadgeName(badge) {
  return badge?.badge_template?.name || badge?.name || null;
}

function getBadgeId(badge) {
  return badge?.id || null;
}

// Given a candidate's typed certification name, tries to find a matching
// badge in a fetched Credly wallet. Returns the matching badge or null.
function findMatchingBadge(certName, badges) {
  const normalizedTarget = normalizeCertName(certName);
  if (!normalizedTarget) return null;

  return badges.find((badge) => {
    const badgeName = getBadgeName(badge);
    if (!badgeName) return false;
    const normalizedBadge = normalizeCertName(badgeName);
    return normalizedBadge === normalizedTarget
      || normalizedBadge.includes(normalizedTarget)
      || normalizedTarget.includes(normalizedBadge);
  }) || null;
}

// Splits a fetched badge wallet into badges that match something already
// on the candidate's profile vs. badges that don't match anything —
// the latter are candidates for the "we found more badges" opt-in prompt.
function findUnmatchedBadges(existingCertifications, badges) {
  return badges.filter((badge) => {
    const badgeName = getBadgeName(badge);
    if (!badgeName) return false;

    const alreadyListed = existingCertifications.some((cert) => {
      const normalizedExisting = normalizeCertName(cert.name);
      const normalizedBadge = normalizeCertName(badgeName);
      return normalizedExisting === normalizedBadge
        || normalizedExisting.includes(normalizedBadge)
        || normalizedBadge.includes(normalizedExisting);
    });

    return !alreadyListed;
  });
}

// Attempts the "auto-guess" Credly username derived from a candidate's
// name (firstname-lastname, Credly's default pattern for anyone who never
// customized their profile URL). Returns the badge array if it resolves
// to a real, public profile with at least one badge; returns null
// silently on any failure (wrong guess, private profile, no such user) —
// this is a background convenience attempt, not a user-facing error.
async function tryCredlyAutoGuess(firstName, lastName) {
  const guessedUsername = `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '');

  try {
    const badges = await fetchCredlyBadges(guessedUsername);
    if (badges.length > 0) {
      return { username: guessedUsername, badges };
    }
    return null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  fetchCredlyBadges,
  findMatchingBadge,
  findUnmatchedBadges,
  tryCredlyAutoGuess,
  normalizeCertName,
  getBadgeName,
  getBadgeId,
};