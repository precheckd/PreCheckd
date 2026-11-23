// A candidate's LinkedIn profile: a linkedin.com/in/... address, or an explicit "I don't have LinkedIn".
function clean(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (!/^([a-z]{2,3}\.)?linkedin\.com$|^www\.linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/in\/([^/]+)\/?/i);
  if (!m) return null;
  return 'https://www.linkedin.com/in/' + m[1].slice(0, 100);
}
// -> { url, none } or { error }
function fromBody(body) {
  const none = body.noLinkedin === 'yes' || body.noLinkedin === 'on' || body.noLinkedin === true;
  if (none) return { url: null, none: true };
  const url = clean(body.linkedinUrl);
  if (!url) return { error: 'Add your LinkedIn profile address (linkedin.com/in/yourname), or tick "I don\'t have LinkedIn".' };
  return { url, none: false };
}
module.exports = { clean, fromBody };
