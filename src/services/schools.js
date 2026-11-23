// Looking up schools in the directory (models/School): the picker's suggestions, and tying a profile's education
// entries to a directory school so a verification request knows where to go.
const School = require('../models/School');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Names that start with, or contain, what was typed. Names only: nothing about contacts is ever sent to the browser.
async function suggest(q, limit = 8) {
  const key = School.keyOf(q);
  if (key.length < 2) return [];
  const rows = await School.find({ nameKey: { $regex: esc(key) } }).select('name').limit(40);
  const rank = (r) => (r.nameKey && r.nameKey.startsWith(key) ? 0 : 1);
  return rows.map((r) => ({ id: String(r._id), name: r.name, nameKey: School.keyOf(r.name) }))
    .sort((a, b) => (a.nameKey.startsWith(key) ? 0 : 1) - (b.nameKey.startsWith(key) ? 0 : 1) || a.name.length - b.name.length)
    .slice(0, limit).map(({ id, name }) => ({ id, name }));
}

// Sets schoolId on each entry whose typed name matches a directory school exactly (ignoring case and punctuation).
async function link(entries) {
  const list = (entries || []).filter(Boolean);
  const keys = [...new Set(list.map((e) => School.keyOf(e.schoolName)).filter(Boolean))];
  if (!keys.length) return list;
  const found = await School.find({ nameKey: { $in: keys } }).select('nameKey');
  const byKey = new Map(found.map((s) => [s.nameKey, s._id]));
  for (const e of list) e.schoolId = byKey.get(School.keyOf(e.schoolName)) || null;
  return list;
}

module.exports = { suggest, link };
