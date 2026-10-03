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

// Runs a candidate's certifications against a fetched Credly badge wallet,
// marking any matches as verified with the badge's real issue date. Never
// un-verifies a cert that was already verified by some other means — only
// adds verification, never removes it.
function applyCredlyMatches(certifications, badges) {
  return certifications.map((cert) => {
    if (cert.verified) return cert;

    const match = findMatchingBadge(cert.name, badges);
    if (!match) return cert;

    return {
      ...cert,
      verified: true,
      verifiedAt: match.issued_at_date ? new Date(match.issued_at_date) : new Date(),
    };
  });
}

// Attempts to sync a candidate's certifications against Credly — either
// using their already-stored username, a newly-provided one from a form,
// or a background auto-guess if neither exists yet. Mutates
// candidate.certifications, candidate.credlyUsername/credlyLastSyncedAt,
// and candidate.credlyUnmatchedBadges in place; never throws when no
// username was explicitly provided — sync failures are silent in that case,
// since Credly is a bonus verification path, not a required one. Throws
// only when a providedUsername was given and doesn't resolve, so the
// caller can surface that as a real form error. Returns nothing; mutation
// is the interface.
//
// Used both right after signup (auto-guess only, no providedUsername yet —
// there's no Credly-username field on the signup form) and on every save
// of the candidate edit form.
async function syncWithCredly(candidate, providedUsername) {
  const usernameToTry = (providedUsername && providedUsername.trim())
    ? providedUsername.trim()
    : candidate.credlyUsername;

  const applyBadges = (badges) => {
    candidate.certifications = applyCredlyMatches(candidate.certifications, badges);
    const unmatched = findUnmatchedBadges(candidate.certifications, badges);
    candidate.credlyUnmatchedBadges = unmatched.map((badge) => ({
      badgeId: getBadgeId(badge),
      name: getBadgeName(badge),
      issuerName: badge?.issuer?.entities?.[0]?.entity?.name || null,
      issuedAt: badge?.issued_at_date || null,
      expiresAt: badge?.expires_at_date || null,
    }));
  };

  if (usernameToTry) {
    try {
      const badges = await fetchCredlyBadges(usernameToTry);
      candidate.credlyUsername = usernameToTry;
      candidate.credlyLastSyncedAt = new Date();
      applyBadges(badges);
      return;
    } catch (error) {
      if (providedUsername) {
        throw new Error('Could not find a public Credly profile for that username. Please double-check it and try again.');
      }
      return;
    }
  }

  const guess = await tryCredlyAutoGuess(candidate.firstName, candidate.lastName);
  if (guess) {
    candidate.credlyUsername = guess.username;
    candidate.credlyLastSyncedAt = new Date();
    applyBadges(guess.badges);
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
  applyCredlyMatches,
  syncWithCredly,
};