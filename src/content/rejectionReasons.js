// Why an applicant is not moving forward. The recruiter picks one from this fixed list (no free text) and the
// candidate sees the sentence, so a rejection always comes with something to work on. A reason that only makes
// sense after a step (an interview, a screening) is only offered, and only accepted, once the applicant got there.
// The role-test area is in the list but only accepted for someone who actually has a role-test result on the
// application (JobApplication.roleTestResult), so it can never be picked for a person who did not take one.
const REJECTION_REASONS = [
  { code: 'interview', label: 'Interview: how they presented their experience', stages: ['interviewing', 'offer'],
    candidateText: 'Area to work on: how you present your experience in interviews.' },
  { code: 'skill_depth', label: 'Skill level: a higher verified level would help',
    candidateText: 'Area to work on: skill level. A higher verified skill level would strengthen your applications for roles like this.' },
  { code: 'experience', label: 'Hands-on experience with this kind of work',
    candidateText: 'Area to work on: hands-on experience with the kind of work this role involves.' },
  { code: 'communication', label: 'Communication during the process', stages: ['screening', 'interviewing', 'offer'],
    candidateText: 'Area to work on: communication during the process.' },
  { code: 'role_test', label: 'The role-specific test for this job', needsRoleTest: true,
    candidateText: 'Area to work on: the role-specific test for this job.' },
  { code: 'role_changed', label: 'The role is on hold or has changed',
    candidateText: 'The role is on hold or has changed.' },
  { code: 'no_response', label: 'We could not reach the candidate',
    candidateText: 'The employer was unable to reach you to continue.' },
];

// No longer offered; kept so a rejection saved under an older code still reads correctly.
const LEGACY_REASONS = [
  { code: 'filled', label: 'Position filled', candidateText: 'The position has been filled.', legacy: true },
  { code: 'other_candidates', label: 'Moving forward with other candidates', candidateText: 'The employer is moving forward with other candidates.', legacy: true },
  { code: 'not_a_fit', label: 'Not the right fit for the team or role', candidateText: 'The employer decided this was not the right fit for the team or role.', legacy: true },
];

const byCode = (c) => REJECTION_REASONS.concat(LEGACY_REASONS).find((r) => r.code === c) || null;
// Reasons that can honestly apply to someone currently at this stage.
const reasonsFor = (status, { roleTest = false } = {}) => REJECTION_REASONS.filter((r) => (!r.stages || r.stages.includes(status)) && (!r.needsRoleTest || roleTest));
const allowedFor = (reason, status, { roleTest = false } = {}) => Boolean(reason && !reason.legacy && (!reason.stages || reason.stages.includes(status)) && (!reason.needsRoleTest || roleTest));
module.exports = { REJECTION_REASONS, LEGACY_REASONS, byCode, reasonsFor, allowedFor };
