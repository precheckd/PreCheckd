// The apply gate: can this candidate apply to this posting, and if not, exactly why.
//
// A PURE function. It takes plain data (no database calls) so every rule can be tested on its own.
// Adapters elsewhere turn a Candidate and a Posting into the shapes below (see docs/job-board-spec.md).
//
// Kent's rule: if an applicant does not meet a criterion, stop the application, say why, and offer two
// the fix (an action link, where there is one) and then apply for the position again. The apply button never
// shows while a blocker exists, so there is nothing to withdraw.
//
// ---------------------------------------------------------------------------------------------------
// INPUT SHAPES
//
// candidate (facts, built from the profile; skill levels are the REAL published levels, including
// skills the candidate hides from recruiters):
//   verified:        { email, phone, identity }              all three must be true
//   skills:          [{ key, label?, level, takenAt, reviewing?, nextAttemptAt? }]
//                    level is one of SKILL_LEVELS; reviewing = a result is held for integrity review;
//                    nextAttemptAt = date the next attempt is allowed (60-day lock), if in the future
//   education:       { verifiedLevel, pendingLevel }         indexes into EDUCATION_LEVELS, 0 = none.
//                    pendingLevel = highest level reported but not yet verified
//   certs:           [{ catalogId, label?, verified, expiresAt }]
//   clearance:       index into CLEARANCE_LEVELS (what the candidate REPORTED), 0 or null = none
//   shifts:          array of SHIFTS the candidate is willing to work
//   availableFrom:   Date | null
//   areaMatch:       true | false | null   computed by the geo adapter against the candidate's Work Areas
//                    for the posting's area rule; null = the candidate has drawn no Work Areas
//   membershipActive:true | false | undefined (undefined = billing not built yet, not checked)
//   alreadyApplied:  boolean
//   blockedByRecruiter: boolean
//
// posting:
//   status:          'open' | 'closed' ...   closeDate: Date
//   skills:          [{ key, label, minLevel }]   minLevel null/undefined = no minimum (entry level)
//   education:       index into EDUCATION_LEVELS or null
//   certGroups:      [[{ catalogId, label }, ...], ...]   AND across groups, OR inside a group
//   clearance:       index into CLEARANCE_LEVELS or null
//   shift:           one of SHIFTS            ('flexible' on a posting = no shift requirement)
//   arrangement:     'onsite' | 'hybrid' | 'remote' | 'remote_in_area'
//   areaLabel:       text for the area message, e.g. "NY, NJ and CT" or "within 50 miles of Boston, MA"
//   startDate:       Date | null    startFirm: boolean
// ---------------------------------------------------------------------------------------------------

const { levelName } = require('../utils/levelName');
const SKILL_LEVELS = ['Developing', 'Foundational', 'Intermediate', 'Advanced', 'Expert'];
const EDUCATION_LEVELS = [null, 'High school or GED', 'Associate degree', "Bachelor's degree", "Master's degree", 'Doctorate'];
const CLEARANCE_LEVELS = [null, 'Public Trust', 'Secret', 'Top Secret', 'TS/SCI'];
const SHIFTS = ['daytime', 'evenings', 'overnight', 'rotating', 'flexible'];
const SHIFT_LABELS = { daytime: 'standard daytime', evenings: 'evenings', overnight: 'overnight', rotating: 'rotating', flexible: 'flexible' };
const STALE_MS = 365 * 86400000;
const DAY = 86400000;

function levelIndex(name) { return SKILL_LEVELS.indexOf(name); }
function article(word) { return /^[aeiou]/i.test(word) ? 'an' : 'a'; }
// Moments in time (a retake date) show in New York time; calendar days stored as UTC midnight
// (a cert's expiry day, a start date, an available-from date) show as that exact day.
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}
function fmtDay(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function joinOr(labels) {
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return labels[0] + ' or ' + labels[1];
  return labels.slice(0, -1).join(', ') + ', or ' + labels[labels.length - 1];
}

// Entry level means NO minimum skill level on any skill (Kent: "a guy off the street can do it").
function isEntryLevel(posting) {
  return (posting.skills || []).every((s) => !s.minLevel);
}

function skillBlocker(req, candidate, now) {
  if (!req.minLevel) return null;
  const need = levelIndex(req.minLevel);
  const label = req.label || req.key;
  const have = (candidate.skills || []).find((s) => s.key === req.key);
  const haveIdx = have ? levelIndex(have.level) : -1;
  const stale = have && now - new Date(have.takenAt).getTime() > STALE_MS;
  const base = { criterion: 'skill', skillKey: req.key };

  if (have && haveIdx >= need && !stale) return null; // met

  const phrase = `${article(levelName(req.minLevel))} ${levelName(req.minLevel)} skill score for ${label}`;
  if (have && have.reviewing) {
    return { ...base, code: 'skill_reviewing',
      message: `Your ${label} result is being reviewed. We will let you know as soon as it is done, and then you can apply for this position again.`,
      actions: [] };
  }
  if (have && haveIdx >= need && stale) {
    const when = have.nextAttemptAt && new Date(have.nextAttemptAt).getTime() > now;
    if (when) {
      return { ...base, code: 'skill_locked', retakeOn: new Date(have.nextAttemptAt),
        message: `This job requires ${phrase}. Your ${label} result is more than 12 months old and needs a retake. You can retake it on ${fmtDate(have.nextAttemptAt)}, and then apply for this position again.`,
        actions: [] };
    }
    return { ...base, code: 'skill_stale',
      message: `This job requires ${phrase}. Your ${label} result is more than 12 months old and needs a retake. Retake it, and then apply for this position again.`,
      actions: [{ kind: 'start_track', skillKey: req.key }] };
  }
  if (have && have.nextAttemptAt && new Date(have.nextAttemptAt).getTime() > now) {
    return { ...base, code: 'skill_locked', retakeOn: new Date(have.nextAttemptAt),
      message: `This job requires ${phrase}. You can retake the test on ${fmtDate(have.nextAttemptAt)}, and then apply for this position again.`,
      actions: [] };
  }
  const youAre = have && haveIdx >= 1 ? ` Your current level is ${levelName(have.level)}.` : '';
  return { ...base, code: have ? 'skill_below' : 'skill_missing',
    message: `This job requires ${phrase} which you do not currently possess.${youAre} Take the skill test, and then apply for this position again.`,
    actions: [{ kind: 'start_track', skillKey: req.key }] };
}

function educationBlocker(posting, candidate) {
  const need = posting.education;
  if (!need) return null;
  const ed = candidate.education || {};
  if ((ed.verifiedLevel || 0) >= need) return null;
  const label = EDUCATION_LEVELS[need];
  if ((ed.pendingLevel || 0) >= need) {
    return { criterion: 'education', code: 'education_pending',
      message: `This job requires a ${label} or higher. Yours is being verified. We will notify you the moment it is done, and then you can apply for this position again.`,
      actions: [] };
  }
  return { criterion: 'education', code: 'education_missing',
    message: `This job requires a ${label} or higher, and we do not have one verified on your profile. Add and verify it on your profile, and then apply for this position again.`,
    actions: [{ kind: 'edit_profile', section: 'education' }] };
}

function certBlockers(posting, candidate, now) {
  const out = [];
  (posting.certGroups || []).forEach((group, i) => {
    if (!group || !group.length) return;
    const ids = new Set(group.map((c) => c.catalogId));
    const mine = (candidate.certs || []).filter((c) => ids.has(c.catalogId));
    // a cert is valid through the end of its expiry day (expiresAt is that day at UTC midnight)
    const valid = (c) => c.verified && (!c.expiresAt || now < new Date(c.expiresAt).getTime() + DAY);
    if (mine.some(valid)) return;
    const labels = group.map((c) => c.label || c.catalogId);
    const options = joinOr(labels);
    const expired = mine.find((c) => c.verified && c.expiresAt && now >= new Date(c.expiresAt).getTime() + DAY);
    const unverified = mine.find((c) => !c.verified);
    const base = { criterion: 'certification', group: i };
    if (expired) {
      const l = expired.label || (group.find((c) => c.catalogId === expired.catalogId) || {}).label || expired.catalogId;
      out.push({ ...base, code: 'cert_expired',
        message: `This job requires one of: ${options}. Your ${l} expired on ${fmtDay(expired.expiresAt)}. Renew it and update your profile, and then apply for this position again.`,
        actions: [{ kind: 'edit_profile', section: 'certifications' }] });
    } else if (unverified) {
      const l = unverified.label || (group.find((c) => c.catalogId === unverified.catalogId) || {}).label || unverified.catalogId;
      out.push({ ...base, code: 'cert_unverified',
        message: `This job requires one of: ${options}. Your ${l} is not verified yet. We will let you know when it is, and then you can apply for this position again.`,
        actions: [] });
    } else {
      const many = labels.length > 1;
      out.push({ ...base, code: 'cert_missing',
        message: many
          ? `This job requires one of: ${options}. You do not have any of these verified. Add one to your profile, and then apply for this position again.`
          : `This job requires ${options}. You do not have it verified. Add it to your profile, and then apply for this position again.`,
        actions: [{ kind: 'edit_profile', section: 'certifications' }] });
    }
  });
  return out;
}

function clearanceBlocker(posting, candidate) {
  const need = posting.clearance;
  if (!need) return null;
  if ((candidate.clearance || 0) >= need) return null;
  return { criterion: 'clearance', code: 'clearance_missing',
    message: `This job requires ${CLEARANCE_LEVELS[need]} clearance and your profile does not list it. If you hold it, update your profile and apply for this position again.`,
    actions: [{ kind: 'edit_profile', section: 'clearance' }] };
}

function shiftBlocker(posting, candidate) {
  const need = posting.shift;
  if (!need || need === 'flexible') return null;            // a flexible posting has no shift requirement
  const mine = candidate.shifts || [];
  if (mine.includes(need) || mine.includes('flexible')) return null; // a candidate who ticked flexible can work any
  const label = SHIFT_LABELS[need] || need;
  return { criterion: 'shift', code: 'shift_missing',
    message: `You have not selected to work the hours of this job (${label}). If you do want to work ${label} hours, update your profile and apply for this position again.`,
    actions: [{ kind: 'edit_profile', section: 'shifts' }] };
}

function areaBlocker(posting, candidate) {
  const arr = posting.arrangement;
  if (!arr || arr === 'remote') return null;
  if (candidate.areaMatch === true) return null;
  if (candidate.areaMatch == null) {
    return { criterion: 'area', code: 'area_unset',
      message: 'This job needs a location match and you have not set your Work Areas yet. Add them on your profile, and then apply for this position again.',
      actions: [{ kind: 'edit_profile', section: 'workAreas' }] };
  }
  if (arr === 'remote_in_area') {
    return { criterion: 'area', code: 'area_outside',
      message: `This remote job is limited to ${posting.areaLabel || 'a specific area'}, and your Work Areas do not include it. If you would work from there, update your Work Areas and apply for this position again.`,
      actions: [{ kind: 'edit_profile', section: 'workAreas' }] };
  }
  return { criterion: 'area', code: 'area_outside',
    message: 'This job is outside your Work Areas. If you would consider it, update your Work Areas and apply for this position again.',
    actions: [{ kind: 'edit_profile', section: 'workAreas' }] };
}

function availabilityBlocker(posting, candidate) {
  if (!posting.startFirm || !posting.startDate) return null;
  if (!candidate.availableFrom) return null; // not set: not later than the start date, so not blocked
  if (new Date(candidate.availableFrom).getTime() <= new Date(posting.startDate).getTime()) return null;
  return { criterion: 'availability', code: 'availability_late',
    message: `This job starts on ${fmtDay(posting.startDate)} and the start date is firm. Your profile says you are available from ${fmtDay(candidate.availableFrom)}. If that has changed, update your availability and apply for this position again.`,
    actions: [{ kind: 'edit_profile', section: 'availability' }] };
}

// Returns { canApply, closed, blockers[] }. Blockers are ordered: account state first, then the
// requirements in the order a candidate would fix them.
function evaluate(candidate, posting, now = Date.now()) {
  const blockers = [];
  const closeMs = posting.closeDate ? new Date(posting.closeDate).getTime() : null;
  const closed = (posting.status && posting.status !== 'open') || (closeMs != null && now > closeMs);
  if (closed) {
    return { canApply: false, closed: true,
      blockers: [{ criterion: 'posting', code: 'posting_closed', message: 'This position is closed.', actions: [] }] };
  }

  if (candidate.alreadyApplied) {
    blockers.push({ criterion: 'posting', code: 'already_applied', message: 'You have already applied to this job.', actions: [] });
  }
  if (candidate.blockedByRecruiter) {
    blockers.push({ criterion: 'recruiter', code: 'recruiter_block', message: 'You cannot apply to this posting.', actions: [] });
  }
  const v = candidate.verified || {};
  if (!(v.email && v.phone && v.identity)) {
    blockers.push({ criterion: 'account', code: 'not_verified',
      message: 'Finish verifying your account (email, phone and identity), and then apply for this position again.',
      actions: [{ kind: 'edit_profile', section: 'verification' }] });
  }
  if (candidate.membershipActive === false) {
    blockers.push({ criterion: 'account', code: 'membership_inactive',
      message: 'Your membership is not active. Renew it, and then apply for this position again.',
      actions: [{ kind: 'billing' }] });
  }

  for (const req of posting.skills || []) {
    const b = skillBlocker(req, candidate, now);
    if (b) blockers.push(b);
  }
  const edu = educationBlocker(posting, candidate);
  if (edu) blockers.push(edu);
  blockers.push(...certBlockers(posting, candidate, now));
  const clr = clearanceBlocker(posting, candidate);
  if (clr) blockers.push(clr);
  const sh = shiftBlocker(posting, candidate);
  if (sh) blockers.push(sh);
  const ar = areaBlocker(posting, candidate);
  if (ar) blockers.push(ar);
  const av = availabilityBlocker(posting, candidate);
  if (av) blockers.push(av);

  return { canApply: blockers.length === 0, closed: false, blockers };
}

// True when the candidate meets every REQUIREMENT of the posting, ignoring account state and having
// already applied. Used for "jobs you now qualify for" notices.
const REQUIREMENT_CRITERIA = new Set(['skill', 'education', 'certification', 'clearance', 'shift', 'area', 'availability']);
function qualifies(candidate, posting, now = Date.now()) {
  const r = evaluate({ ...candidate, alreadyApplied: false }, posting, now);
  if (r.closed) return false;
  return !r.blockers.some((b) => REQUIREMENT_CRITERIA.has(b.criterion));
}

module.exports = {
  SKILL_LEVELS, EDUCATION_LEVELS, CLEARANCE_LEVELS, SHIFTS, SHIFT_LABELS,
  isEntryLevel, evaluate, qualifies
};
