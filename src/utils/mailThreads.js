// Groups a member's Mail messages into conversations, the way Gmail does.
//
// Two messages are in the same conversation when:
//   - one names the other in its In-Reply-To / References headers, or
//   - a reply we sent (direction 'out') points at it (inReplyToMailId), or
//   - they have the same subject (ignoring Re:/Fwd:) with the same other person.
// Works on the messages passed in, so older mail without any link still groups
// by subject. Nothing here touches the database.

function normSubject(subject) {
  return String(subject || '')
    .replace(/^\s*((re|fwd?)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function idTokens(text) {
  return String(text || '').split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}

// The other person in the exchange: who sent it (received) or who we wrote to (sent).
function otherParty(m) {
  return String(m.direction === 'out' ? m.toAddress : m.fromAddress || '').trim().toLowerCase();
}

function buildThreads(messages) {
  const list = messages.slice();
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

  const byHeader = new Map();
  const byId = new Map();
  list.forEach((m, i) => {
    if (m.messageIdHeader) byHeader.set(String(m.messageIdHeader).trim(), i);
    byId.set(String(m._id), i);
  });
  const bySubject = new Map();
  list.forEach((m, i) => {
    idTokens(`${m.referencesHeader || ''} ${m.inReplyToHeader || ''}`).forEach((t) => {
      if (byHeader.has(t)) union(i, byHeader.get(t));
    });
    if (m.inReplyToMailId && byId.has(String(m.inReplyToMailId))) union(i, byId.get(String(m.inReplyToMailId)));
    const subj = normSubject(m.subject);
    const who = otherParty(m);
    if (subj && who) {
      const key = `${who}\u0000${subj}`;
      if (bySubject.has(key)) union(i, bySubject.get(key)); else bySubject.set(key, i);
    }
  });

  const groups = new Map();
  list.forEach((m, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(m);
  });
  return [...groups.values()].map((g) => g.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt)));
}

// The conversation that contains message `id`, oldest message first (or null).
function threadOf(messages, id) {
  return buildThreads(messages).find((t) => t.some((m) => String(m._id) === String(id))) || null;
}

module.exports = { buildThreads, threadOf, normSubject };
