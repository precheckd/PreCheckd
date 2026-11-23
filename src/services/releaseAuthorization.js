// The electronic authorization a candidate signs at signup so PreCheckd can contact the employers and schools on
// their profile. One text, versioned, so a saved record always says exactly what was agreed to.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const VERSION = 1;
const TEXT = 'I authorize PreCheckd to contact the employers and schools I list on my PreCheckd profile to confirm my employment '
  + '(job title and dates) and my education (degree, major, and dates of attendance or graduation), for the purpose of verifying my profile. '
  + 'I authorize those employers and schools to release that information to PreCheckd. PreCheckd will share only the confirmation, '
  + 'not my records. I can withdraw this authorization at any time by deleting the entry or my account. '
  + 'I intend my typed name to be my electronic signature.';

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);

// Checks the checkbox and typed name and returns the record to save, or { error }.
function record({ accepted, typedName, firstName, lastName, ip, now = new Date() }) {
  if (accepted !== 'yes' && accepted !== true && accepted !== 'on') return { error: 'Please check the box to authorize PreCheckd to verify the employers and schools on your profile.' };
  const typed = words(typedName);
  const first = words(firstName)[0];
  const last = words(lastName).slice(-1)[0];
  if (!typed.length || !first || !last || !typed.includes(first) || !typed.includes(last)) {
    return { error: 'Type your full name as your electronic signature (first and last name, as entered above).' };
  }
  return { value: { version: VERSION, typedName: String(typedName).trim().slice(0, 120), acceptedAt: now, ip: String(ip || '').slice(0, 64) } };
}

// One-page PDF for a registrar: who authorized what, and when. No date of birth on it.
async function pdfFor({ candidate, subject, detail, dates, caseId, kind = 'educationHistory' }) {
  const work = kind === 'workHistory';
  const auth = candidate.releaseAuthorization || {};
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.16, 0.18);
  let y = 740;
  const line = (text, { size = 11, f = font, gap = 16 } = {}) => { page.drawText(text, { x: 54, y, size, font: f, color: ink }); y -= gap; };
  const wrap = (text, size = 11, width = 504) => {
    let cur = '';
    for (const w of String(text).split(/\s+/)) {
      const next = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(next, size) > width) { line(cur, { size }); cur = w; } else cur = next;
    }
    if (cur) line(cur, { size });
  };
  const name = `${candidate.firstName} ${candidate.lastName || ''}`.trim();
  line(work ? 'Authorization to verify employment' : 'Authorization to verify education', { size: 18, f: bold, gap: 30 });
  line(`Graduate: ${name}`, { f: bold });
  if (detail) line(work ? `Job title: ${detail}` : `Degree: ${detail}`);
  line(work ? `Employer: ${subject}` : `School: ${subject}`);
  if (dates) line(`Dates: ${dates}`, { gap: 26 });
  line('Authorization', { size: 13, f: bold, gap: 20 });
  wrap(TEXT, 11);
  y -= 14;
  line('Signed electronically', { size: 13, f: bold, gap: 20 });
  line(`Name typed as signature: ${auth.typedName || name}`);
  line(`Date and time: ${auth.acceptedAt ? new Date(auth.acceptedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'on file'}`);
  line(`Authorization version: ${auth.version || VERSION}${caseId ? `    Reference: ${String(caseId).slice(-8)}` : ''}`, { gap: 26 });
  wrap('This authorization was collected by PreCheckd (precheckd.com) when the graduate created an account. Questions: verifications@precheckd.com.', 9);
  return Buffer.from(await doc.save());
}

module.exports = { VERSION, TEXT, record, pdfFor };
