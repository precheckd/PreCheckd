#!/usr/bin/env node
/**
 * CoderByte API probe. Read-only: lists assessments and (optionally) pulls one
 * candidate's report so we can see the real JSON shape. Nothing is stored.
 *
 * Needs env: CODERBYTE_API_KEY   (CODERBYTE_ORG_ID optional, used only if a plain
 *                                  Bearer key is rejected and we try a signed JWT)
 *
 *   node scripts/coderbyte-probe.js                       -> list assessments
 *   node scripts/coderbyte-probe.js <email> <assessmentId> -> pull that report
 *
 * The candidate email is masked in the output so it is safe to paste into chat.
 */
const crypto = require('crypto');

const BASE = 'https://coderbyte.com/api/organization';
const KEY = process.env.CODERBYTE_API_KEY;
const ORG = process.env.CODERBYTE_ORG_ID;

if (!KEY) {
  console.error('Set CODERBYTE_API_KEY first.');
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString('base64url');
function signedJwt() {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: ORG, iat: now, exp: now + 300 }));
  const sig = crypto.createHmac('sha256', KEY).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function call(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// Try the plain key first; if rejected and we know the org id, try a signed JWT.
async function authed(path) {
  let r = await call(path, KEY);
  let mode = 'bearer-key';
  if ((r.status === 401 || r.status === 403) && ORG) {
    r = await call(path, signedJwt());
    mode = 'signed-jwt';
  }
  return { ...r, mode };
}

function mask(obj, email) {
  let s = JSON.stringify(obj, null, 2);
  if (email) s = s.split(email).join('candidate@example.com');
  return s;
}

(async () => {
  const [email, assessmentId] = process.argv.slice(2);

  const list = await authed('/assessments');
  console.log(`GET /assessments -> ${list.status} (auth: ${list.mode})`);
  console.log(mask(list.body, email).slice(0, 6000));

  if (email && assessmentId) {
    const path = `/candidates/${encodeURIComponent(email)}/${encodeURIComponent(assessmentId)}`;
    const rep = await authed(path);
    console.log(`\nGET /candidates/<email>/<assessmentId> -> ${rep.status} (auth: ${rep.mode})`);
    console.log(mask(rep.body, email));
  } else {
    console.log('\nTo pull a report: node scripts/coderbyte-probe.js <email> <assessmentId>');
  }
})().catch((e) => { console.error(e); process.exit(1); });
