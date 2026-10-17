// Verified email signature: the name, an optional line, and the "Verified by
// PreCheckd" badge linking to the member's public verification page. Email-safe
// table HTML (inline styles, a PNG image, no scripts) plus a plain-text version.
const { escapeHtml } = require('../utils/emailLayout');

function baseUrl() { return process.env.APP_BASE_URL || 'https://precheckd.com'; }

// What a member can use, or why not. kind: 'candidate' | 'recruiter'.
function eligibility(kind, owner) {
  if (kind === 'candidate') {
    if (!(owner.isIdentityVerified && owner.isPhoneVerified)) return { ok: false, reason: 'verify' };
    if (!owner.publicVerifyPage) return { ok: false, reason: 'public_off' };
    return { ok: true };
  }
  if (owner.isSuspended || owner.accountTier === 'unverified_claim' || !owner.isActive || !(owner.isIdentityVerified && owner.isPhoneVerified)) {
    return { ok: false, reason: 'verify' };
  }
  return { ok: true };
}

function linksFor(kind, owner) {
  const b = baseUrl();
  return {
    link: kind === 'candidate' ? `${b}/verify/${owner.slug}?ref=signature` : `${b}/recruiter/${owner.slug}?ref=signature`,
    badge: `${b}/badge/${kind}/${owner.slug}.png`
  };
}

function build({ name, line, link, badge }) {
  const n = escapeHtml(name);
  const l = line ? escapeHtml(line) : '';
  const html = `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#222222;">
<tr><td style="padding:0 0 2px 0;font-size:15px;font-weight:bold;color:#1F363C;">${n}</td></tr>${l ? `
<tr><td style="padding:0 0 8px 0;color:#555555;">${l}</td></tr>` : `
<tr><td style="padding:0 0 6px 0;"></td></tr>`}
<tr><td><a href="${escapeHtml(link)}" target="_blank" style="text-decoration:none;"><img src="${escapeHtml(badge)}" width="224" height="44" alt="Verified by PreCheckd" style="display:block;border:0;outline:none;"></a></td></tr>
<tr><td style="padding:4px 0 0 0;font-size:12px;"><a href="${escapeHtml(link)}" target="_blank" style="color:#1F9E58;text-decoration:none;">Check my verification</a></td></tr>
</table>`;
  const text = `${name}${line ? `\n${line}` : ''}\nVerified by PreCheckd: ${link}`;
  return { html, text };
}

module.exports = { eligibility, linksFor, build, baseUrl };
