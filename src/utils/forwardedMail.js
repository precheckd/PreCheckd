// Reads a forwarded message (roadmap #5): when a candidate forwards a job
// confirmation from their own inbox, find the ORIGINAL sender, subject and
// body inside the forward so the tracker can read it. Pure text rules, no
// database. The caller decides whether the forward may be trusted (it must come
// from the candidate's own registered address and pass authentication).

// Start of a forwarded block, in the formats mail apps actually produce.
const MARKERS = [
  /^-{3,}\s*Forwarded message\s*-{3,}\s*$/im,          // Gmail
  /^Begin forwarded message:\s*$/im,                   // Apple Mail
  /^-{3,}\s*Original Message\s*-{3,}\s*$/im,           // Outlook (classic), Yahoo
  /^_{10,}\s*$/m                                       // Outlook web: a line of underscores
];

const HEADER_LINE = /^(from|sent|date|to|cc|subject|reply-to)\s*:\s*(.*)$/i;

function parseFrom(value) {
  const v = String(value || '').trim();
  const m = v.match(/^"?([^"<\[]*?)"?\s*<([^>\s]+@[^>\s]+)>/)
    || v.match(/^"?([^"<\[]*?)"?\s*\[mailto:([^\]\s]+@[^\]\s]+)\]/i)
    || v.match(/^()([^\s<>]+@[^\s<>]+)$/);
  if (!m) return null;
  return { name: m[1].trim().replace(/^["']|["']$/g, ''), address: m[2].trim().toLowerCase() };
}

// Returns { fromName, fromAddress, subject, textBody } for the first forwarded
// block, or null when the text has none.
function unwrapForwarded(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  let start = -1;
  let markerEnd = -1;
  for (const re of MARKERS) {
    const m = re.exec(t);
    if (m && (start === -1 || m.index < start)) { start = m.index; markerEnd = m.index + m[0].length; }
  }
  // Some apps (Outlook, Thunderbird) forward with only a header block.
  const lines = t.slice(start === -1 ? 0 : markerEnd).split('\n');

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  const headers = {};
  let last = null;
  let count = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') { if (count > 0) break; continue; }
    const m = HEADER_LINE.exec(line.trim());
    if (m) { last = m[1].toLowerCase(); if (!headers[last]) headers[last] = m[2].trim(); count += 1; continue; }
    // A wrapped header value continues on an indented line.
    if (last && /^\s+\S/.test(line) && count > 0) { headers[last] += ` ${line.trim()}`; continue; }
    break;
  }
  if (start === -1 && !(headers.from && headers.subject)) return null;
  if (!headers.from || !headers.subject) return null;

  const from = parseFrom(headers.from);
  if (!from) return null;
  const body = lines.slice(i).join('\n').trim();
  if (!body) return null;
  return {
    fromName: from.name,
    fromAddress: from.address,
    subject: headers.subject.replace(/^(\s*(fwd?|re)\s*:\s*)+/i, '').slice(0, 300),
    textBody: body
  };
}

module.exports = { unwrapForwarded };
