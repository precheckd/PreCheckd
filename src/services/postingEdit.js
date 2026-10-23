// Pure helpers for creating and editing a JobPosting from the recruiter form (no database, no network).
//   docFromValue    validated form value (+ looked-up location) -> the fields saved on the posting
//   formFromPosting a saved posting -> the form body shape, to pre-fill the edit form
//   changedParts    which parts of a posting an edit changed, for the edit log

const nyDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

function docFromValue(value, location) {
  return {
    nickname: value.nickname, titleId: value.titleId, title: value.title, skills: value.skills, seniorityLabel: value.seniorityLabel,
    hiringCompany: value.hiringCompany, authorizedToRecruit: value.authorizedToRecruit,
    employmentType: value.employmentType, contractLength: value.contractLength, openings: value.openings,
    arrangement: value.arrangement, inOfficeDays: value.inOfficeDays, areaReason: value.areaReason,
    address: value.address, areaRule: location.areaRule || undefined, areaLabel: location.areaLabel,
    displayCity: location.displayCity, displayState: location.displayState,
    relocation: value.relocation, travel: value.travel, shift: value.shift,
    basePayType: value.basePayType, baseMin: value.baseMin, baseMax: value.baseMax, commissionOnly: value.commissionOnly,
    payBasis: value.payBasis, commission: value.commission, bonus: value.bonus, equity: value.equity, tips: value.tips,
    benefits: value.benefits, benefitsOther: value.benefitsOther, noBenefits: value.noBenefits,
    goodFaithAt: value.goodFaithAt, commissionAckAt: value.commissionAckAt,
    education: value.education, certGroups: value.certGroups, clearance: value.clearance,
    startDate: value.startDate, startFirm: value.startFirm, closeDate: value.closeDate, requirementsAttestedAt: value.requirementsAttestedAt, outcomeAckAt: value.outcomeAckAt,
    summary: value.summary, responsibilities: value.responsibilities,
  };
}

const yes = (b) => (b ? 'on' : undefined);

// The commission confirmation is deliberately NOT pre-ticked: Kent's rule is that the warning shows, and is
// accepted, every time commission is entered. The other attestations were already given and stay ticked.
function formFromPosting(p) {
  const o = typeof p.toObject === 'function' ? p.toObject() : p;
  const rule = o.areaRule || {};
  const groups = (o.certGroups || []).map((g) => {
    const ids = g.certs.map((c) => c.catalogId);
    while (ids.length < 5) ids.push('');
    return ids;
  });
  while (groups.length < 3) groups.push(['', '', '', '', '']);
  const hasCommission = Boolean(o.commissionOnly || (o.commission && o.commission.average));
  const f = {
    skills: [0, 1, 2].map((i) => (o.skills[i] ? { key: o.skills[i].key, minLevel: o.skills[i].minLevel || '' } : { key: '', minLevel: '' })),
    titleId: o.titleId, nickname: o.nickname || '', hiringCompany: o.hiringCompany, authorizedToRecruit: yes(o.authorizedToRecruit),
    employmentType: o.employmentType, contractLength: o.contractLength || '', openings: String(o.openings),
    arrangement: o.arrangement, inOfficeDays: o.inOfficeDays ? String(o.inOfficeDays) : '', areaReason: o.areaReason || '',
    states: rule.states || [], radiusMiles: rule.radiusMiles ? String(rule.radiusMiles) : '', address: o.address || '',
    relocation: o.relocation ? 'yes' : 'no', travel: o.travel, shift: o.shift,
    basePayType: o.commissionOnly ? '' : o.basePayType,
    baseMin: o.commissionOnly ? '' : String(o.baseMin), baseMax: o.commissionOnly ? '' : String(o.baseMax),
    commissionOnly: yes(o.commissionOnly), commissionEnabled: yes(hasCommission && !o.commissionOnly),
    commissionMin: o.commission && o.commission.minAnticipated ? String(o.commission.minAnticipated) : '',
    commissionAverage: o.commission && o.commission.average ? String(o.commission.average) : '',
    payBasis: o.payBasis || [],
    bonusOffered: yes(o.bonus && o.bonus.offered), bonusNote: (o.bonus && o.bonus.note) || '',
    equityOffered: yes(o.equity && o.equity.offered), equityNote: (o.equity && o.equity.note) || '',
    tipsOffered: yes(o.tips && o.tips.offered), tipsNote: (o.tips && o.tips.note) || '',
    benefits: o.benefits || [], benefitsOther: o.benefitsOther || '', noBenefits: yes(o.noBenefits),
    goodFaith: yes(o.goodFaithAt),
    education: o.education || '', certGroups: groups, clearance: o.clearance || '',
    closeDate: nyDay(o.closeDate), startDate: new Date(o.startDate).toISOString().slice(0, 10), startFirm: yes(o.startFirm),
    requirementsAttested: yes(o.requirementsAttestedAt), outcomeAck: yes(o.outcomeAckAt),
    summary: o.summary, responsibilities: (o.responsibilities || []).join('\n'),
  };
  Object.keys(f).forEach((k) => { if (f[k] === undefined) delete f[k]; });
  return f;
}

// ---- edit log ----------------------------------------------------------------------------------

const PARTS = {
  'title and skills': ['titleId', 'skills'],
  company: ['hiringCompany'],
  'job details': ['employmentType', 'contractLength', 'openings'],
  location: ['arrangement', 'inOfficeDays', 'areaReason', 'address', 'areaRule', 'relocation', 'travel', 'shift'],
  pay: ['basePayType', 'baseMin', 'baseMax', 'commissionOnly', 'payBasis', 'commission', 'bonus', 'equity', 'tips', 'benefits', 'benefitsOther', 'noBenefits'],
  requirements: ['education', 'certGroups', 'clearance', 'startFirm'],
  dates: ['startDate', 'closeDate'],
  description: ['summary', 'responsibilities'],
};

// Comparable form of a value: dates as ISO strings, empty things dropped.
function norm(x) {
  if (x === null || x === undefined || x === '') return undefined;
  if (x instanceof Date) return x.toISOString();
  if (Array.isArray(x)) { const a = x.map(norm).filter((v) => v !== undefined); return a.length ? a : undefined; }
  if (typeof x === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(x)) { const n = norm(v); if (n !== undefined && k !== '_id') out[k] = n; }
    return Object.keys(out).length ? out : undefined;
  }
  return x;
}

function changedParts(before, after) {
  const b = typeof before.toObject === 'function' ? before.toObject() : before;
  const changed = [];
  for (const [part, keys] of Object.entries(PARTS)) {
    const differs = keys.some((k) => JSON.stringify(norm(b[k])) !== JSON.stringify(norm(after[k])));
    if (differs) changed.push(part);
  }
  return changed;
}

module.exports = { docFromValue, formFromPosting, changedParts, PARTS };
