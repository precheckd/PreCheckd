// Single source of truth for what a recruiter can see about a candidate
// before a connection has been accepted. Used by both the candidate-search
// results (recruiters browsing) and the pending-request view (recruiter's
// inbox) — anything pre-connection goes through here so the rule lives in
// exactly one place instead of drifting between the two surfaces.
//
// What's visible pre-connection: anonymized identity (anonId, no name/photo),
// job titles and dates (employer blocked), degrees and grad dates (school
// blocked), certifications (these alone don't identify anyone), and
// yes/no verification badges. Bio is free-text and easy to identify someone
// from, so it's hidden entirely until a connection exists.
const { activeCerts } = require('../utils/certExpiry');

function getAnonymizedCandidateView(candidate) {
  return {
    anonId: candidate.anonId,
    displayName: `Candidate ${candidate.anonId}`,
    photoUrl: null,
    bio: null,
    workHistory: (candidate.workHistory || []).map((job) => ({
      jobTitle: job.jobTitle,
      employerName: null,
      startDate: job.startDate,
      endDate: job.endDate,
      verified: job.verified
    })),
    educationHistory: (candidate.educationHistory || []).map((edu) => ({
      degree: edu.degree,
      schoolName: null,
      graduationDate: edu.graduationDate,
      verified: edu.verified
    })),
    certifications: activeCerts(candidate.certifications).map((cert) => ({
      name: cert.name,
      verified: cert.verified
    })),
    verification: {
      emailVerified: Boolean(candidate.emailVerifiedAt),
      phoneVerified: Boolean(candidate.isPhoneVerified),
      identityVerified: Boolean(candidate.isIdentityVerified)
    },
    email: null,
    phone: null
  };
}

// Full, real-identity view — used once a connection is accepted. Video and
// resume are deliberately NOT included here: those stay behind the
// separate bundled full-access request even post-connection, so callers
// that need them check fullAccessStatus === 'granted' on the
// ConnectionRequest themselves before exposing introVideoUrl/interviewVideos/
// resumeUrl.
//
// Email and phone are NOT included by default — a recruiter only gets them
// if the candidate chose to share them (see utils/contactSharing.js), which
// callers pass in as `sharedContact` ({ email, phone } or null).
function getFullCandidateView(candidate, sharedContact) {
  return {
    anonId: candidate.anonId,
    displayName: `${candidate.firstName} ${candidate.lastName}`,
    photoUrl: candidate.profilePhotoUrl,
    bio: candidate.bio,
    workHistory: candidate.workHistory || [],
    educationHistory: candidate.educationHistory || [],
    certifications: activeCerts(candidate.certifications),
    verification: {
      emailVerified: Boolean(candidate.emailVerifiedAt),
      phoneVerified: Boolean(candidate.isPhoneVerified),
      identityVerified: Boolean(candidate.isIdentityVerified)
    },
    email: sharedContact ? sharedContact.email : null,
    phone: sharedContact ? sharedContact.phone : null
  };
}

module.exports = { getAnonymizedCandidateView, getFullCandidateView };
