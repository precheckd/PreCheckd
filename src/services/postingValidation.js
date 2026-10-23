// Validates the recruiter's job-posting form and turns it into the values saved on a JobPosting.
// Pure: no database, no network. The route supplies the list of skills that can be picked and does the
// address lookup afterwards (this returns `needsAddress` and the typed `address`).
//
//   const { errors, value } = validatePosting(req.body, { now, skillLabels: Map<key, label> });
//   if (Object.keys(errors).length) -> show errors by field name; otherwise save `value`.
//
// Every rule here comes from the Oct 21 decisions in docs/job-board-spec.md.

const { titlesForSkills, byId: titleById } = require('../content/jobTitles');
const { catalogIdFor, byId: certById, CATALOG } = require('../content/certCatalog');
const { STATE_CODES } = require('../utils/geo');
const { scanFields } = require('../utils/textScan');
const opt = require('../content/postingOptions');

const DAY = 86400000;
const codes = (list) => list.map((x) => x.code);
const STATE_SET = new Set(Object.values(STATE_CODES));
const CERT_IDS = new Set(CATALOG.map((c) => c.id));

// ---- small helpers -----------------------------------------------------------------------------

const asArray = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v]);
const text = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const flag = (v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 'yes';

function parseMoney(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Number(s);
}

function parseYmd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d, utcMidnight: probe };
}

function nyParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), mi: Number(parts.minute), s: Number(parts.second) };
}

// 23:59:59 on that calendar day in New York, as a moment in time. Applications close at the end of the day.
function endOfDayNewYork({ y, mo, d }) {
  for (const offset of [4, 5]) {
    const guess = new Date(Date.UTC(y, mo - 1, d, 23 + offset, 59, 59));
    const p = nyParts(guess);
    if (p.y === y && p.mo === mo && p.d === d && p.h === 23 && p.mi === 59 && p.s === 59) return guess;
  }
  return new Date(Date.UTC(y, mo - 1, d, 28, 59, 59));
}

function todayNewYork(now) {
  const p = nyParts(new Date(now));
  return { y: p.y, mo: p.mo, d: p.d, utcMidnight: new Date(Date.UTC(p.y, p.mo - 1, p.d)) };
}

// Label for the seniority the skill levels imply. Never typed by the recruiter.
function seniorityLabel(skills) {
  const rank = { Foundational: 1, Intermediate: 2, Advanced: 3, Expert: 4 };
  const top = Math.max(0, ...skills.map((s) => rank[s.minLevel] || 0));
  return ['Entry level', 'Junior', 'Mid-level', 'Senior', 'Lead / Principal'][top];
}

const BLIND_NAME = /\b(confidential|undisclosed|anonymous|stealth|unnamed|private\s+client)\b|^(client|tbd|n\/?a|none|unknown|company|the company|a company|our client|my client)$/i;

// ---- the validator -----------------------------------------------------------------------------

function validatePosting(body, ctx) {
  const b = body || {};
  const now = ctx.now || Date.now();
  const errors = {};
  const err = (field, message) => { if (!errors[field]) errors[field] = message; };
  const v = {};

  // Skills first: they decide which titles can be offered.
  const picked = asArray(b.skills).map((s) => ({ key: text(s && s.key, 60), minLevel: text(s && s.minLevel, 20) })).filter((s) => s.key);
  const seen = new Set();
  const skills = [];
  for (const s of picked) {
    if (seen.has(s.key)) { err('skills', 'Each skill can only be picked once.'); continue; }
    seen.add(s.key);
    if (!ctx.skillLabels.has(s.key)) { err('skills', 'One of those skills is not available.'); continue; }
    if (s.minLevel && !opt.MIN_LEVELS.includes(s.minLevel)) { err('skills', 'Pick a minimum level from the list, or none.'); continue; }
    skills.push({ key: s.key, label: ctx.skillLabels.get(s.key), minLevel: s.minLevel || null });
  }
  if (!skills.length) err('skills', 'Pick at least one skill. The job title comes from the skills.');
  if (skills.length > opt.LIMITS.maxSkills) err('skills', `Pick up to ${opt.LIMITS.maxSkills} skills.`);
  v.skills = skills.slice(0, opt.LIMITS.maxSkills);
  v.seniorityLabel = seniorityLabel(v.skills);

  // Title: only from the catalog, only one that covers every picked skill.
  const titleId = text(b.titleId, 80);
  const offered = titlesForSkills(v.skills.map((s) => s.key));
  if (!titleId) err('titleId', 'Choose a job title.');
  else if (!offered.some((t) => t.id === titleId)) err('titleId', 'That title does not fit the skills you picked. Choose one from the list.');
  else { v.titleId = titleId; v.title = titleById(titleId).title; }

  v.nickname = text(b.nickname, 60);

  // Company
  v.hiringCompany = text(b.hiringCompany, 100);
  if (v.hiringCompany.length < 2) err('hiringCompany', 'Enter the company where the job is.');
  else if (BLIND_NAME.test(v.hiringCompany)) err('hiringCompany', 'Enter the real company name. Confidential or blind postings are not allowed.');
  else if (scanFields({ c: v.hiringCompany }).c && scanFields({ c: v.hiringCompany }).c.some((i) => i.code === 'email' || i.code === 'phone')) err('hiringCompany', 'Enter just the company name.');
  if (!flag(b.authorizedToRecruit)) err('authorizedToRecruit', 'Confirm you are authorized by this company to recruit for this role.');
  v.authorizedToRecruit = flag(b.authorizedToRecruit);

  // Employment
  v.employmentType = text(b.employmentType, 20);
  if (!codes(opt.EMPLOYMENT_TYPES).includes(v.employmentType)) err('employmentType', 'Choose an employment type.');
  v.contractLength = text(b.contractLength, 60);
  if (v.employmentType === 'contract' && !v.contractLength) err('contractLength', 'Contract roles need an end date or length, for example "6 months".');
  if (v.employmentType !== 'contract') v.contractLength = '';
  const openings = Number(b.openings);
  if (!Number.isInteger(openings) || openings < 1 || openings > 500) err('openings', 'Enter the number of openings (1 to 500).');
  v.openings = openings;

  // Location
  v.arrangement = text(b.arrangement, 20);
  if (!codes(opt.ARRANGEMENTS).includes(v.arrangement)) err('arrangement', 'Choose how the work is done.');
  v.address = text(b.address, 200);
  v.inOfficeDays = null;
  v.areaReason = null;
  v.states = [];
  v.radiusMiles = null;
  v.needsAddress = false;
  if (v.arrangement === 'onsite' || v.arrangement === 'hybrid') {
    v.needsAddress = true;
    if (!v.address) err('address', 'Enter the street address of the work location. Candidates never see it.');
  }
  if (v.arrangement === 'hybrid') {
    const days = Number(b.inOfficeDays);
    if (!Number.isInteger(days) || days < 1 || days > 4) err('inOfficeDays', 'Enter how many days a week are in the office (1 to 4).');
    v.inOfficeDays = days;
  }
  if (v.arrangement === 'remote_in_area') {
    v.areaReason = text(b.areaReason, 10);
    if (v.areaReason === 'states') {
      v.states = [...new Set(asArray(b.states).map((s) => text(s, 2).toUpperCase()).filter((s) => STATE_SET.has(s)))];
      if (!v.states.length) err('states', 'Pick the states this remote job is limited to.');
      v.address = '';
    } else if (v.areaReason === 'radius') {
      v.needsAddress = true;
      if (!v.address) err('address', 'Enter the address to measure the radius from. Candidates never see it.');
      const miles = Number(b.radiusMiles);
      if (!Number.isInteger(miles) || miles < 5 || miles > 300) err('radiusMiles', 'Enter a radius between 5 and 300 miles.');
      v.radiusMiles = miles;
    } else {
      err('areaReason', 'Say why this remote job is limited to an area.');
      v.areaReason = null;
    }
  }
  if (v.arrangement === 'remote') v.address = '';
  v.relocation = b.relocation === 'yes' ? true : b.relocation === 'no' ? false : null;
  if (v.relocation === null) err('relocation', 'Say whether relocation is offered.');
  v.travel = text(b.travel, 20);
  if (!codes(opt.TRAVEL).includes(v.travel)) err('travel', 'Choose how much travel is required.');
  v.shift = text(b.shift, 20);
  if (!codes(opt.SHIFT_OPTIONS).includes(v.shift)) err('shift', 'Choose the shift.');

  // Pay
  v.commissionOnly = flag(b.commissionOnly);
  v.basePayType = v.commissionOnly ? 'salary' : text(b.basePayType, 10); // a $0 base has no type to choose
  if (!['salary', 'hourly'].includes(v.basePayType)) err('basePayType', 'Choose salary or hourly.');
  const commissionOn = v.commissionOnly || flag(b.commissionEnabled);
  if (v.commissionOnly) {
    v.baseMin = 0;
    v.baseMax = 0;
  } else {
    v.baseMin = parseMoney(b.baseMin);
    v.baseMax = parseMoney(b.baseMax);
    const [lo, hi] = v.basePayType === 'hourly' ? [7, 500] : [15000, 1000000];
    if (!(v.baseMin > 0) || !(v.baseMax > 0)) err('baseRange', 'Enter the base pay range, minimum and maximum.');
    else if (v.baseMin < lo || v.baseMax > hi) err('baseRange', `Base pay should be between $${lo.toLocaleString('en-US')} and $${hi.toLocaleString('en-US')} ${v.basePayType === 'hourly' ? 'an hour' : 'a year'}. If the job is commission only, tick that box instead.`);
    else if (v.baseMax < v.baseMin) err('baseRange', 'The maximum cannot be below the minimum.');
    else if (v.baseMax > v.baseMin * opt.LIMITS.payWidth + 1e-9) err('baseRange', 'The maximum can be at most 25% above the minimum. Narrow the range, or explain big swings through commission below.');
  }
  v.payBasis = [...new Set(asArray(b.payBasis).map((p) => text(p, 20)).filter((p) => codes(opt.PAY_BASIS).includes(p)))];
  if (!v.payBasis.length) err('payBasis', 'Say what the pay range is based on.');
  v.commission = { minAnticipated: null, average: null };
  v.commissionAckAt = null;
  if (commissionOn) {
    const minC = parseMoney(b.commissionMin);
    const avgC = parseMoney(b.commissionAverage);
    if (!(minC > 0)) err('commission', 'Enter the minimum anticipated commission.');
    else if (!(avgC > 0)) err('commission', 'Enter the average commission.');
    else if (avgC < minC) err('commission', 'The average commission cannot be below the minimum.');
    v.commission = { minAnticipated: minC, average: avgC };
    if (!flag(b.commissionAck)) err('commissionAck', 'Confirm the commission statement. Postings with false pay information are removed, and posting privileges may be suspended.');
    else v.commissionAckAt = new Date(now);
  }
  for (const k of ['bonus', 'equity', 'tips']) {
    const offered = flag(b[`${k}Offered`]);
    v[k] = { offered, note: offered ? text(b[`${k}Note`], opt.LIMITS.noteMax) : '' };
  }
  v.benefits = [...new Set(asArray(b.benefits).map((x) => text(x, 30)).filter((x) => codes(opt.BENEFITS).includes(x)))];
  v.noBenefits = flag(b.noBenefits);
  v.benefitsOther = text(b.benefitsOther, 80);
  if (v.noBenefits && (v.benefits.length || v.benefitsOther)) err('benefits', 'Untick "No benefits offered" or clear the benefits you ticked.');
  else if (!v.noBenefits && !v.benefits.length && !v.benefitsOther) err('benefits', 'Tick the benefits offered, or tick "No benefits offered".');
  if (!flag(b.goodFaith)) err('goodFaith', 'Confirm the pay is what you actually expect to pay for this role.');
  v.goodFaithAt = flag(b.goodFaith) ? new Date(now) : null;

  // Requirements
  const edu = text(b.education, 20);
  v.education = edu || null;
  if (edu && !codes(opt.EDUCATION_LEVELS).includes(edu)) err('education', 'Choose an education level from the list.');
  const rawGroups = asArray(b.certGroups).map((g) => asArray(g).map((id) => text(id, 80)).filter(Boolean)).filter((g) => g.length);
  if (rawGroups.length > opt.LIMITS.maxCertGroups) err('certGroups', `Use up to ${opt.LIMITS.maxCertGroups} certification groups.`);
  v.certGroups = [];
  for (const g of rawGroups.slice(0, opt.LIMITS.maxCertGroups)) {
    const ids = [...new Set(g)];
    if (ids.length > opt.LIMITS.maxCertsPerGroup) { err('certGroups', `Use up to ${opt.LIMITS.maxCertsPerGroup} certifications in a group.`); continue; }
    if (ids.some((id) => !CERT_IDS.has(id))) { err('certGroups', 'One of those certifications is not on the list.'); continue; }
    v.certGroups.push({ certs: ids.map((id) => ({ catalogId: id, label: certById(id).name })) });
  }
  const clr = text(b.clearance, 20);
  v.clearance = clr || null;
  if (clr && !codes(opt.CLEARANCE_OPTIONS).includes(clr)) err('clearance', 'Choose a clearance level from the list.');

  // Dates
  const today = todayNewYork(now);
  const close = parseYmd(b.closeDate);
  if (!close) err('closeDate', 'Enter the date applications close.');
  else {
    const days = Math.round((close.utcMidnight - today.utcMidnight) / DAY);
    // Editing: the posting may stay open through today, and the 45 days count from the day it was first posted
    // (so a recruiter can extend a posting, but not keep it open forever).
    const editing = ctx.editing && ctx.editing.createdAt;
    const limitDays = editing ? Math.round((todayNewYork(new Date(ctx.editing.createdAt).getTime()).utcMidnight - today.utcMidnight) / DAY) + opt.LIMITS.maxCloseDays : opt.LIMITS.maxCloseDays;
    if (days < (editing ? 0 : 1)) err('closeDate', editing ? 'The close date cannot be in the past. To end the posting now, close it instead.' : 'The close date must be after today.');
    else if (days > limitDays) err('closeDate', editing ? `Applications can stay open at most ${opt.LIMITS.maxCloseDays} days from the day the job was first posted.` : `Applications can stay open at most ${opt.LIMITS.maxCloseDays} days.`);
    else v.closeDate = endOfDayNewYork(close);
  }
  const start = parseYmd(b.startDate);
  if (!start) err('startDate', 'Enter the in-seat start date.');
  else {
    const days = Math.round((start.utcMidnight - today.utcMidnight) / DAY);
    if (close && start.utcMidnight < close.utcMidnight) err('startDate', 'The start date cannot be before applications close.');
    else if (days > opt.LIMITS.maxStartDays) err('startDate', 'The start date is too far out.');
    else v.startDate = start.utcMidnight;
  }
  v.startFirm = flag(b.startFirm);
  if (!flag(b.requirementsAttested)) err('requirementsAttested', 'Confirm the requirements are genuinely required for this job and lawful.');
  v.requirementsAttestedAt = flag(b.requirementsAttested) ? new Date(now) : null;
  if (!flag(b.outcomeAck)) err('outcomeAck', 'Confirm you understand that you must record how this job ended when applications close.');
  v.outcomeAckAt = flag(b.outcomeAck) ? new Date(now) : null;

  // Description
  v.summary = String(b.summary || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (v.summary.length < opt.LIMITS.summaryMin) err('summary', `Write a role summary of at least ${opt.LIMITS.summaryMin} characters.`);
  else if (v.summary.length > opt.LIMITS.summaryMax) err('summary', `Keep the role summary under ${opt.LIMITS.summaryMax} characters.`);
  v.responsibilities = String(Array.isArray(b.responsibilities) ? b.responsibilities.join('\n') : b.responsibilities || '')
    .split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const respChars = v.responsibilities.join('\n').length;
  if (respChars < opt.LIMITS.respTotalMin) err('responsibilities', 'Add the main responsibilities of the role. Paste them in if you already have them.');
  else if (respChars > opt.LIMITS.respTotalMax) err('responsibilities', `Keep responsibilities under ${opt.LIMITS.respTotalMax} characters.`);

  // Free-text scan on every field the recruiter writes
  const scanned = scanFields({
    summary: v.summary, responsibilities: v.responsibilities,
    contractLength: v.contractLength, benefitsOther: v.benefitsOther,
    bonusNote: v.bonus.note, equityNote: v.equity.note, tipsNote: v.tips.note,
  });
  const noteField = { bonusNote: 'bonus', equityNote: 'bonus', tipsNote: 'bonus', benefitsOther: 'benefits' };
  for (const [field, issues] of Object.entries(scanned)) {
    const target = noteField[field] || field;
    const first = issues[0];
    err(target, `${first.message} (found: "${first.match}")`);
  }

  return { errors, value: v };
}

module.exports = {
  validatePosting, parseMoney, parseYmd, endOfDayNewYork, todayNewYork, seniorityLabel, asArray,
};
