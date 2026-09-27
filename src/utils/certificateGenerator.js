const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const QRCode = require('qrcode');
const crypto = require('crypto');

const NAVY = rgb(0.122, 0.212, 0.235); // #1F363C
const GREEN = rgb(0.180, 0.800, 0.443); // #2ECC71
const DARK_TEXT = rgb(0.15, 0.15, 0.15);
const MUTED_TEXT = rgb(0.4, 0.4, 0.4);
const VERIFIED_COLOR = rgb(0.1, 0.55, 0.3);

const PAGE_WIDTH = 612; // Letter size, portrait
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const MAX_ENTRIES_PER_CATEGORY = 5;

function getCertificateId(candidateId) {
  const hash = crypto.createHash('sha256').update(candidateId.toString()).digest('hex');
  return `PC-${hash.slice(0, 10).toUpperCase()}`;
}

function drawLogo(page, x, y, radius) {
  page.drawCircle({
    x, y, size: radius,
    borderColor: GREEN,
    borderWidth: 2.5,
  });
  page.drawSvgPath(
    `M ${-radius * 0.45} ${radius * 0.05} L ${-radius * 0.1} ${radius * 0.4} L ${radius * 0.5} ${-radius * 0.35}`,
    {
      x, y,
      borderColor: GREEN,
      borderWidth: 3,
      scale: 1,
    }
  );
}

function getVerifiedLines(entries, formatLine) {
  if (!entries || entries.length === 0) return [];
  return entries
    .filter((e) => e.verified)
    .slice(0, MAX_ENTRIES_PER_CATEGORY)
    .map(formatLine);
}

async function generateCertificate(candidate, resumeBuffer, baseUrl) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  page.drawRectangle({
    x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: rgb(0.99, 0.98, 0.96),
  });

  page.drawRectangle({
    x: MARGIN, y: MARGIN,
    width: PAGE_WIDTH - MARGIN * 2, height: PAGE_HEIGHT - MARGIN * 2,
    borderColor: NAVY, borderWidth: 2,
  });
  page.drawRectangle({
    x: MARGIN + 8, y: MARGIN + 8,
    width: PAGE_WIDTH - (MARGIN + 8) * 2, height: PAGE_HEIGHT - (MARGIN + 8) * 2,
    borderColor: GREEN, borderWidth: 1,
  });

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  let cursorY = PAGE_HEIGHT - 90;

  drawLogo(page, PAGE_WIDTH / 2, cursorY, 20);
  cursorY -= 45;

  const brandText = 'PreCheckd';
  const brandWidth = timesBold.widthOfTextAtSize(brandText, 16);
  page.drawText(brandText, {
    x: (PAGE_WIDTH - brandWidth) / 2, y: cursorY, size: 16, font: timesBold, color: NAVY,
  });
  cursorY -= 40;

  const title = 'Certificate of Verification';
  const titleWidth = timesBold.widthOfTextAtSize(title, 26);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2, y: cursorY, size: 26, font: timesBold, color: NAVY,
  });
  cursorY -= 45;

  const intro = 'This certifies that the verification statuses below reflect';
  const introWidth = timesRoman.widthOfTextAtSize(intro, 12);
  page.drawText(intro, {
    x: (PAGE_WIDTH - introWidth) / 2, y: cursorY, size: 12, font: timesRoman, color: MUTED_TEXT,
  });
  cursorY -= 16;
  const intro2 = "PreCheckd's records for the individual named below.";
  const intro2Width = timesRoman.widthOfTextAtSize(intro2, 12);
  page.drawText(intro2, {
    x: (PAGE_WIDTH - intro2Width) / 2, y: cursorY, size: 12, font: timesRoman, color: MUTED_TEXT,
  });
  cursorY -= 45;

  const candidateName = `${candidate.firstName} ${candidate.lastName}`;
  const nameWidth = timesBold.widthOfTextAtSize(candidateName, 22);
  page.drawText(candidateName, {
    x: (PAGE_WIDTH - nameWidth) / 2, y: cursorY, size: 22, font: timesBold, color: DARK_TEXT,
  });
  cursorY -= 8;
  page.drawLine({
    start: { x: PAGE_WIDTH / 2 - nameWidth / 2 - 10, y: cursorY },
    end: { x: PAGE_WIDTH / 2 + nameWidth / 2 + 10, y: cursorY },
    thickness: 1, color: GREEN,
  });
  cursorY -= 45;

  const identityRows = [
    { label: 'Email Ownership', verifiedAt: candidate.emailVerifiedAt },
    { label: 'Phone Number', verifiedAt: candidate.phoneVerifiedAt },
    { label: 'Government ID', verifiedAt: candidate.identityVerifiedAt },
    { label: 'Facial Recognition', verifiedAt: candidate.facialRecognitionVerifiedAt },
  ];

  const rowHeight = 22;
  const rowLabelX = MARGIN + 50;
  const rowStatusX = PAGE_WIDTH - MARGIN - 200;
  const sectionHeaderX = MARGIN + 50;

  identityRows.forEach((row, i) => {
    const y = cursorY - i * rowHeight;
    page.drawText(row.label, { x: rowLabelX, y, size: 12, font: helvetica, color: DARK_TEXT });
    if (row.verifiedAt) {
      const dateStr = new Date(row.verifiedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      page.drawText(`Verified ${dateStr}`, { x: rowStatusX, y, size: 11, font: helveticaBold, color: VERIFIED_COLOR });
    } else {
      page.drawText('Pending', { x: rowStatusX, y, size: 11, font: helveticaBold, color: rgb(0.75, 0.35, 0.3) });
    }
  });

  cursorY = cursorY - identityRows.length * rowHeight - 20;

  const certLines = getVerifiedLines(candidate.certifications, (c) => c.name);
  const workLines = getVerifiedLines(candidate.workHistory, (j) => `${j.jobTitle} — ${j.employerName}`);
  const eduLines = getVerifiedLines(candidate.educationHistory, (e) => `${e.degree} — ${e.schoolName}`);

  const sections = [
    { title: 'Verified Certifications', lines: certLines },
    { title: 'Verified Employment', lines: workLines },
    { title: 'Verified Education', lines: eduLines },
  ].filter((s) => s.lines.length > 0);

  sections.forEach((section) => {
    page.drawText(section.title, {
      x: sectionHeaderX, y: cursorY, size: 11, font: helveticaBold, color: NAVY,
    });
    cursorY -= 18;

    section.lines.forEach((line) => {
      page.drawText(`\u2022 ${line}`, {
        x: sectionHeaderX + 10, y: cursorY, size: 10.5, font: helvetica, color: DARK_TEXT,
      });
      cursorY -= 15;
    });

    cursorY -= 8;
  });

  cursorY -= 15;

  const certificateId = getCertificateId(candidate._id);
  const issuedDate = new Date();
  const goodThroughDate = new Date(issuedDate.getTime() + 60 * 24 * 60 * 60 * 1000);
  const dateFmt = { year: 'numeric', month: 'long', day: 'numeric' };

  const metaLines = [
    `Certificate ID: ${certificateId}`,
    `Issued: ${issuedDate.toLocaleDateString('en-US', dateFmt)}`,
    `Good Through: ${goodThroughDate.toLocaleDateString('en-US', dateFmt)}`,
  ];
  metaLines.forEach((line, i) => {
    const w = helvetica.widthOfTextAtSize(line, 10);
    page.drawText(line, { x: (PAGE_WIDTH - w) / 2, y: cursorY - i * 14, size: 10, font: helvetica, color: MUTED_TEXT });
  });

  const verifyUrl = `${baseUrl}/verify/${candidate.slug}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });
  const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
  const qrImage = await pdfDoc.embedPng(qrImageBytes);
  const qrSize = 70;
  page.drawImage(qrImage, {
    x: PAGE_WIDTH - MARGIN - 8 - qrSize - 20,
    y: MARGIN + 20,
    width: qrSize,
    height: qrSize,
  });
  page.drawText('Scan to verify', {
    x: PAGE_WIDTH - MARGIN - 8 - qrSize - 20,
    y: MARGIN + 12,
    size: 8, font: helvetica, color: MUTED_TEXT,
  });

  page.drawText('precheckd.com', {
    x: MARGIN + 20, y: MARGIN + 20, size: 11, font: timesBold, color: NAVY,
  });
  page.drawText('Fixing hiring one verification at a time', {
    x: MARGIN + 20, y: MARGIN + 8, size: 8, font: helvetica, color: MUTED_TEXT,
  });

  if (resumeBuffer) {
    try {
      const resumeDoc = await PDFDocument.load(resumeBuffer);
      const copiedPages = await pdfDoc.copyPages(resumeDoc, resumeDoc.getPageIndices());
      copiedPages.forEach((p) => pdfDoc.addPage(p));
    } catch (error) {
      console.error('Could not merge resume into certificate — resume may not be a valid PDF:', error);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateCertificate };