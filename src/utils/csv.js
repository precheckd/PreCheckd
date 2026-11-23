// Small CSV reader/writer (quotes, commas and newlines inside quotes). No dependencies.
function parse(text) {
  const rows = []; let cur = []; let field = ''; let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) { if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i += 1; cur.push(field); field = ''; if (cur.some((x) => x.trim())) rows.push(cur); cur = []; }
    else field += ch;
  }
  if (field || cur.length) { cur.push(field); if (cur.some((x) => x.trim())) rows.push(cur); }
  if (!rows.length) return [];
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

const cell = (v) => { const t = String(v == null ? '' : v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function stringify(rows, columns) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

module.exports = { parse, stringify };
