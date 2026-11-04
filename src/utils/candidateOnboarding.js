// The guided setup a new candidate is walked through right after signup.
// Each step reads real profile data (no separate "step done" bookkeeping),
// except the sharing step, which has no data of its own: it's done once the
// candidate has confirmed their visibility choice (onboarding.sharingConfirmedAt).
// Steps reuse the existing pages; `page` is the path under /candidate/:slug/.
const { requirements } = require('./candidateMatchingRequirements');

const req = (key) => requirements.find((r) => r.key === key);

const STEPS = [
  {
    key: 'workAreas',
    label: 'Where you\'ll work',
    blurb: 'Draw the area you\'re willing to work in on a map.',
    page: 'work-areas',
    isDone: (c) => req('workAreas').isMet(c)
  },
  {
    key: 'preferences',
    label: 'Pay and work style',
    blurb: 'Your minimum salary, and remote, hybrid or in-office.',
    page: 'job-preferences',
    isDone: (c) => req('minSalary').isMet(c) && req('workArrangement').isMet(c)
  },
  {
    key: 'background',
    label: 'Your background',
    blurb: 'Upload your résumé, connect Credly, or add your work history.',
    page: 'edit',
    isDone: (c) => Boolean(c.resumeUrl || c.credlyUsername || (c.workHistory && c.workHistory.length > 0))
  },
  {
    key: 'sharing',
    label: 'What recruiters can see',
    blurb: 'Confirm whether recruiters can find you.',
    page: 'setup#sharing',
    isDone: (c) => Boolean(c.onboarding && c.onboarding.sharingConfirmedAt)
  }
];

function getSetupSteps(candidate) {
  return STEPS.map((s) => ({ key: s.key, label: s.label, blurb: s.blurb, page: s.page, done: Boolean(s.isDone(candidate)) }));
}

function setupProgress(candidate) {
  const steps = getSetupSteps(candidate);
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length };
}

// True while a new account still has required steps to do.
function isOnboardingPending(candidate) {
  return Boolean(candidate && candidate.onboarding && candidate.onboarding.required && !candidate.onboarding.completedAt);
}

module.exports = { STEPS, getSetupSteps, setupProgress, isOnboardingPending };
