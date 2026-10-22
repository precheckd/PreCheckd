// How a posting ended (docs/job-board-spec.md section 15). Fixed lists on purpose: no silent expiry, no vague reasons.
const OUTCOME_KINDS = [
  { code: 'hired_precheckd', label: 'We hired someone who applied through PreCheckd' },
  { code: 'hired_elsewhere', label: 'We hired someone who did not apply through PreCheckd' },
  { code: 'not_filled', label: 'The job was not filled' },
  { code: 'cancelled', label: 'The job was cancelled' },
];
const NOT_FILLED_REASONS = [
  { code: 'no_qualified', label: 'No qualified applicants' },
  { code: 'declined', label: 'Candidates declined the offer' },
  { code: 'partly_filled', label: 'Some openings were filled, not all' },
  { code: 'on_hold', label: 'The role is on hold' },
  { code: 'budget', label: 'Budget or headcount changed' },
  { code: 'internal', label: 'Filled internally' },
  { code: 'other', label: 'Other (explain)' },
];
const CANCEL_REASONS = [
  { code: 'client_cancelled', label: 'The client cancelled the search' },
  { code: 'role_eliminated', label: 'The role was eliminated' },
  { code: 'budget', label: 'Budget or headcount changed' },
  { code: 'internal', label: 'Filled internally' },
  { code: 'mistake', label: 'Posted by mistake' },
  { code: 'reposting', label: 'Reposting with changes' },
  { code: 'other', label: 'Other (explain)' },
];
// What applicants who were not hired are told. Neutral, never the recruiter's reason.
const CLOSURE_TEXT = {
  hired_precheckd: 'The position has been filled.',
  hired_elsewhere: 'The position has been filled.',
  not_filled: 'The employer did not fill this position.',
  cancelled: 'The position was cancelled.',
};
module.exports = { OUTCOME_KINDS, NOT_FILLED_REASONS, CANCEL_REASONS, CLOSURE_TEXT };
