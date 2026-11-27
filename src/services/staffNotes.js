// Running staff notes (models/StaffNote): add, read a person's timeline, find notes, and the red "conduct" flag.
// Facts only: what happened and when. Nothing here is ever visible to the person or to anyone outside staff.
const StaffNote = require('../models/StaffNote');

const KINDS = { note: 'Note', call: 'Call', conduct: 'Conduct' };
const OUTCOMES = { reached: 'Reached someone', voicemail: 'Left a voicemail', none: 'No answer', wrong: 'Wrong or dead number' };
const MAX_TEXT = 2000;
const MODELS = { candidate: () => require('../models/Candidate'), recruiter: () => require('../models/Recruiter') };
const fail = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Throws .code: subject | kind | empty | long | outcome.
async function add({ subjectType, subjectId, caseId = null, kind = 'note', outcome = '', text }) {
  if (!MODELS[subjectType]) throw fail('subject', 'Unknown kind of account');
  if (!KINDS[kind]) throw fail('kind', 'Pick note, call or conduct');
  const body = String(text || '').trim();
  if (!body) throw fail('empty', 'Write something first');
  if (body.length > MAX_TEXT) throw fail('long', `Keep it under ${MAX_TEXT} characters`);
  if (kind === 'call' && outcome && !OUTCOMES[outcome]) throw fail('outcome', 'Pick an outcome');
  if (!(await MODELS[subjectType]().exists({ _id: subjectId }))) throw fail('subject', 'Account not found');
  return StaffNote.create({ subjectType, subjectId, caseId: caseId || null, kind, outcome: kind === 'call' ? (outcome || '') : '', text: body });
}

// Newest first. Pass caseId to see only that case's notes.
async function forSubject(subjectType, subjectId, { caseId = null, limit = 200 } = {}) {
  const q = { subjectType, subjectId };
  if (caseId) q.caseId = caseId;
  return StaffNote.find(q).sort({ createdAt: -1 }).limit(limit).lean();
}

// Which of these accounts have at least one conduct note: a Set of id strings (for red badges in lists).
async function conductIds(subjectType, ids) {
  if (!ids || !ids.length) return new Set();
  const rows = await StaffNote.distinct('subjectId', { subjectType, kind: 'conduct', subjectId: { $in: ids } });
  return new Set(rows.map(String));
}

// Notes shaped like timeline items (for the shared panel).
const asItems = (notes) => notes.map((n) => ({ at: n.createdAt, kind: n.kind, outcome: n.outcome, text: n.text, caseId: n.caseId ? String(n.caseId) : null, caseLabel: null, source: 'note' }));
const MESSAGES = { saved: 'Note added.', empty: 'Write something first.', long: `Keep it under ${MAX_TEXT} characters.`, outcome: 'Pick an outcome.', kind: 'Pick note, call or conduct.', subject: 'That account was not found.' };

// A candidate's timeline: their notes plus each case's own history, newest first.
async function candidateTimeline(candidateId) {
  const VerificationCase = require('../models/VerificationCase');
  const [notes, cases] = await Promise.all([forSubject('candidate', candidateId), VerificationCase.find({ candidateId }).select('subject detail category log')]);
  const label = new Map(cases.map((c) => [String(c._id), `${c.category === 'workHistory' ? 'Employment' : 'Education'}: ${c.subject}`]));
  const items = notes.map((n) => ({ at: n.createdAt, kind: n.kind, outcome: n.outcome, text: n.text, caseId: n.caseId ? String(n.caseId) : null, caseLabel: n.caseId ? label.get(String(n.caseId)) || 'Case' : null, source: 'note' }));
  for (const c of cases) for (const l of c.log || []) items.push({ at: l.at, kind: 'log', text: l.text, caseId: String(c._id), caseLabel: label.get(String(c._id)), source: 'case log' });
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

// Notes matching text and/or a kind, plus the accounts whose name, email or company match the search.
async function search({ q = '', kind = '', limit = 100 } = {}) {
  const term = String(q || '').trim().slice(0, 100);
  const filter = {};
  if (KINDS[kind]) filter.kind = kind;
  let people = [];
  if (term) {
    const re = new RegExp(escapeRe(term), 'i');
    const [cands, recs] = await Promise.all([
      MODELS.candidate().find({ $or: [{ firstName: re }, { lastName: re }, { email: re }] }).select('firstName lastName email').limit(25).lean(),
      MODELS.recruiter().find({ $or: [{ firstName: re }, { lastName: re }, { email: re }, { company: re }] }).select('firstName lastName email company').limit(25).lean()
    ]);
    people = [
      ...cands.map((c) => ({ type: 'candidate', id: String(c._id), name: `${c.firstName} ${c.lastName || ''}`.trim(), detail: c.email })),
      ...recs.map((r) => ({ type: 'recruiter', id: String(r._id), name: `${r.firstName} ${r.lastName || ''}`.trim(), detail: [r.company, r.email].filter(Boolean).join(' | ') }))
    ];
    const idsByType = { candidate: cands.map((c) => c._id), recruiter: recs.map((r) => r._id) };
    filter.$or = [{ text: re }, { subjectType: 'candidate', subjectId: { $in: idsByType.candidate } }, { subjectType: 'recruiter', subjectId: { $in: idsByType.recruiter } }];
  }
  const notes = await StaffNote.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  // names for the note rows
  const names = new Map();
  for (const type of ['candidate', 'recruiter']) {
    const ids = [...new Set(notes.filter((n) => n.subjectType === type).map((n) => String(n.subjectId)))];
    if (!ids.length) continue;
    const docs = await MODELS[type]().find({ _id: { $in: ids } }).select('firstName lastName').lean();
    docs.forEach((d) => names.set(`${type}:${d._id}`, `${d.firstName} ${d.lastName || ''}`.trim()));
  }
  const rows = notes.map((n) => ({ ...n, subjectName: names.get(`${n.subjectType}:${n.subjectId}`) || 'Unknown' }));
  const conduct = { candidate: await conductIds('candidate', people.filter((p) => p.type === 'candidate').map((p) => p.id)), recruiter: await conductIds('recruiter', people.filter((p) => p.type === 'recruiter').map((p) => p.id)) };
  return { people: people.map((p) => ({ ...p, conduct: conduct[p.type].has(p.id) })), notes: rows };
}

// Called when an account is deleted: delete means deleted.
async function deleteFor(subjectType, subjectId) {
  return StaffNote.deleteMany({ subjectType, subjectId });
}

module.exports = { asItems, MESSAGES, KINDS, OUTCOMES, MAX_TEXT, add, forSubject, conductIds, candidateTimeline, search, deleteFor };
