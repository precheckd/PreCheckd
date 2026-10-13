// Shared look for every PreCheckd email: dark teal header with the logo mark
// and wordmark, white card body, quiet footer. Table-based with inline styles
// so it holds up in Gmail, Outlook and Apple Mail. The logo mark is a PNG
// (email clients block SVG) served from public/email/.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseUrl() {
  return process.env.APP_BASE_URL || 'https://precheckd.com';
}

// Primary call-to-action button.
function emailButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;"><tr><td style="background:#2ECC71;border-radius:8px;"><a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:#12262B;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

// Wraps body HTML in the branded layout.
//   preheader  - hidden preview text shown next to the subject in inboxes
//   footerHtml - replaces the default footer line (e.g. unsubscribe links)
function brandShell({ bodyHtml, preheader = '', footerHtml = '' }) {
  const logo = `${baseUrl()}/email/logo-mark.png`;
  const footer = footerHtml || 'You are receiving this because you have a PreCheckd account.';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#EEF2F3;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#EEF2F3;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF2F3;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${FONT};color:#1F2A2E;line-height:1.55;">
      <tr><td style="background:#1F363C;border-radius:12px 12px 0 0;padding:20px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="${logo}" width="34" height="34" alt="" style="display:block;border:0;"></td>
          <td style="vertical-align:middle;">
            <div style="font-family:${FONT};font-size:24px;font-weight:800;line-height:1;color:#FFFFFF;">Pre<span style="color:#2ECC71;">Checkd</span></div>
            <div style="font-family:${FONT};font-size:12px;color:#9FB4BA;margin-top:5px;">Fixing hiring one verification at a time</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#2ECC71;height:3px;line-height:3px;font-size:3px;">&nbsp;</td></tr>
      <tr><td style="background:#FFFFFF;padding:28px 24px;border:1px solid #DDE5E7;border-top:none;border-radius:0 0 12px 12px;font-size:15px;">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 8px;font-family:${FONT};font-size:12px;line-height:1.5;color:#6B7B80;text-align:center;">
        ${footer}<br>PreCheckd &middot; Fixing hiring one verification at a time
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

module.exports = { brandShell, emailButton, escapeHtml, FONT };
