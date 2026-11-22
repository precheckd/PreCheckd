// Free DNS checks for the public recruiter checker: can this domain receive email, and does it point at a website?
// DNS only. We never connect to the domain itself, so a made-up address can't make our server fetch anything.
// A clear "no such record" answer is reported as 'no'; timeouts and other errors are 'unknown' so a flaky lookup
// never makes a real company look bad.
const dns = require('dns').promises;

const TIMEOUT_MS = 3000;
const NONE = new Set(['ENOTFOUND', 'ENODATA']);

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), TIMEOUT_MS); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 'yes' | 'no' | 'unknown' for one lookup that returns a list.
async function listed(lookup) {
  try {
    const rows = await withTimeout(lookup());
    return Array.isArray(rows) && rows.length ? 'yes' : 'no';
  } catch (e) {
    return NONE.has(e && e.code) ? 'no' : 'unknown';
  }
}

async function check(domain, resolver = dns) {
  const [mx, a, aaaa] = await Promise.all([
    listed(() => resolver.resolveMx(domain)),
    listed(() => resolver.resolve4(domain)),
    listed(() => resolver.resolve6(domain)),
  ]);
  // A domain with an A or AAAA record has a web address. Only call it 'no' when both are clearly missing.
  const web = (a === 'yes' || aaaa === 'yes') ? 'yes' : (a === 'no' && aaaa === 'no') ? 'no' : 'unknown';
  return { mail: mx, web };
}

module.exports = { check };
