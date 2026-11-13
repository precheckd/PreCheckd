// Suggests skills and job titles from a job description, for the posting form.
//   suggest({ summary, responsibilities }, skillOptions, { recruiterId }) -> { skills: [{key,label}], titles: [string], missing: [string], source }
// The AI may only pick from our own tested skills (skillOptions); it never sets levels and never saves anything,
// the recruiter confirms every skill. If the AI is unavailable the same skills are found by matching skill names in the
// text, so the form always works. Capped per recruiter per day.
const MODEL = process.env.CHAT_MODEL || 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TEXT = 8000;
const MAX_SKILLS = 3;                          // the form takes three skills
const DAILY_LIMIT = Number(process.env.SUGGEST_DAILY_LIMIT) || 30;
const used = new Map();                         // recruiterId -> { day, n }

function allow(recruiterId, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const u = used.get(String(recruiterId));
  if (!u || u.day !== day) { used.set(String(recruiterId), { day, n: 1 }); return true; }
  if (u.n >= DAILY_LIMIT) return false;
  u.n++; return true;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// No-AI fallback: which of our skills are named in the text, most-mentioned first.
function keywordSkills(text, options) {
  const hits = [];
  for (const o of options) {
    const re = new RegExp(`(^|[^a-z0-9])${esc(o.label.toLowerCase())}($|[^a-z0-9])`, 'g');
    const n = (text.toLowerCase().match(re) || []).length;
    if (n) hits.push({ o, n });
  }
  return hits.sort((a, b) => b.n - a.n).slice(0, MAX_SKILLS).map((h) => ({ key: h.o.key, label: h.o.label }));
}

function prompt(text, options) {
  return `You help a recruiter fill in a job posting. Read the job description and pick the skills the job most needs.

Allowed skills (use ONLY these exact keys):
${options.map((o) => `${o.key} = ${o.label}`).join('\n')}

Job description:
---
${text}
---

Return only JSON: {"skills": [up to ${MAX_SKILLS} allowed keys, most important first], "titles": [up to 3 plausible job titles, each under 60 characters, plain words], "missing": [up to 5 important technologies or skills in the description that are NOT in the allowed list, short names]}.
Never invent keys. If nothing fits, use an empty list.`;
}

function parse(raw, options) {
  let o;
  try { o = JSON.parse(String(raw).replace(/^```json\s*|```$/g, '').trim()); } catch (e) { return null; }
  const byKey = new Map(options.map((x) => [x.key, x]));
  const skills = []; 
  for (const k of Array.isArray(o.skills) ? o.skills : []) {
    const hit = byKey.get(String(k));
    if (hit && !skills.some((s) => s.key === hit.key)) skills.push({ key: hit.key, label: hit.label });
  }
  const clean = (arr, n, max) => (Array.isArray(arr) ? arr : []).map((x) => String(x || '').replace(/[<>]/g, '').trim()).filter((x) => x.length >= 2 && x.length <= max).slice(0, n);
  return { skills: skills.slice(0, MAX_SKILLS), titles: clean(o.titles, 3, 60), missing: clean(o.missing, 5, 40) };
}

async function suggest({ summary, responsibilities }, options, { recruiterId, fetchImpl = fetch } = {}) {
  const text = `${summary || ''}\n${Array.isArray(responsibilities) ? responsibilities.join('\n') : responsibilities || ''}`.trim().slice(0, MAX_TEXT);
  if (text.length < 40) return { error: 'short' };
  if (!allow(recruiterId)) return { error: 'limit' };
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
      const res = await fetchImpl(API_URL, { method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 400, temperature: 0, messages: [{ role: 'user', content: prompt(text, options) }] }) });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const out = parse((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), options);
        if (out) return { ...out, source: 'ai' };
      } else console.error('Suggest API error:', res.status);
    } catch (e) { console.error('Suggest failed:', e.name === 'AbortError' ? 'timeout' : e.message); }
  }
  return { skills: keywordSkills(text, options), titles: [], missing: [], source: 'keywords' };
}

module.exports = { suggest, keywordSkills, parse, allow, MAX_SKILLS };
