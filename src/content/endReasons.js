// Fixed reasons for ending a connection (docs/job-board-spec.md section 16). The other side never sees the reason.
// `alert` reasons also go to staff (Trust & Safety).
const CANDIDATE_REASONS = [
  { code: 'never_contacted', label: 'They never contacted me about a real opening' },
  { code: 'irrelevant_roles', label: 'The roles they sent were not relevant' },
  { code: 'pushy', label: 'They were pushy' },
  { code: 'off_platform', label: 'They asked for off-platform contact or sensitive information', alert: true },
  { code: 'suspicious', label: 'Something about them seems suspicious', alert: true },
  { code: 'not_interested', label: 'I am just not interested' },
];
const RECRUITER_REASONS = [
  { code: 'role_filled', label: 'The role was filled' },
  { code: 'not_a_fit', label: 'Not a fit' },
  { code: 'unresponsive', label: 'The candidate did not respond' },
  { code: 'inappropriate', label: 'Inappropriate behavior', alert: true },
  { code: 'other', label: 'Other' },
];
const reasonsFor = (side) => (side === 'candidate' ? CANDIDATE_REASONS : RECRUITER_REASONS);
const findReason = (side, code) => reasonsFor(side).find((r) => r.code === code) || null;

// Survey answers (internal only).
const SURVEY_CONTACTED = [
  { code: 'real_opening', label: 'Yes, about a real opening' },
  { code: 'not_real', label: 'Yes, but not about a real opening' },
  { code: 'no_contact', label: 'No, not yet' },
];
const SURVEY_RESPECTFUL = [
  { code: 'yes', label: 'Yes' },
  { code: 'somewhat', label: 'Somewhat' },
  { code: 'no', label: 'No' },
];

module.exports = { CANDIDATE_REASONS, RECRUITER_REASONS, reasonsFor, findReason, SURVEY_CONTACTED, SURVEY_RESPECTFUL };
