// Why a recruiter rejected an applicant. The recruiter picks one and the candidate sees that reason
// (candidateText), so they get an answer instead of silence. Fixed list on purpose: no free text, nothing personal.
const REJECTION_REASONS = [
  { code: 'filled', label: 'Position filled', candidateText: 'The position has been filled.' },
  { code: 'other_candidates', label: 'Moving forward with other candidates', candidateText: 'The employer is moving forward with other candidates.' },
  { code: 'not_a_fit', label: 'Not the right fit for the team or role', candidateText: 'The employer decided this was not the right fit for the team or role.' },
  { code: 'role_changed', label: 'Role on hold or changed', candidateText: 'The role is on hold or has changed.' },
  { code: 'no_response', label: 'Candidate stopped responding', candidateText: 'The employer reports they did not hear back from you.' },
];
const byCode = (c) => REJECTION_REASONS.find((r) => r.code === c) || null;
module.exports = { REJECTION_REASONS, byCode };
