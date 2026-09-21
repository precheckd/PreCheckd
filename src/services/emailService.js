const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function sendVerificationEmail(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/founding-recruiter/verify-email?token=${token}`;

  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Verify your email for PreCheckd',
    html: `
      <p>Hi ${firstName},</p>
      <p>Click the link below to verify your email address for your PreCheckd profile:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 48 hours. If you didn't sign up for PreCheckd, you can safely ignore this email.</p>
    `,
  });
}

async function sendLoginEmail(toEmail, firstName, token) {
  const loginUrl = `${process.env.APP_BASE_URL}/login/verify?token=${token}`;

  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Your PreCheckd login link',
    html: `
      <p>Hi ${firstName},</p>
      <p>Click the link below to log in to your PreCheckd account:</p>
      <p><a href="${loginUrl}">${loginUrl}</a></p>
      <p>This link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

async function sendCandidateLoginCode(toEmail, firstName, code) {
  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Your PreCheckd login code',
    html: `
      <p>Hi ${firstName},</p>
      <p>Your login code is: <strong>${code}</strong></p>
      <p>Enter this code to log back into PreCheckd. This code expires in 10 minutes.</p>
    `,
  });
}

async function sendCandidateVerificationLink(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/candidate/verify-email?token=${token}`;

  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Verify your email for PreCheckd',
    html: `
      <p>Hi ${firstName},</p>
      <p>Click the link below to verify your email address for your PreCheckd profile:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 48 hours. If you didn't sign up for PreCheckd, you can safely ignore this email.</p>
    `,
  });
}

async function sendConnectionAcceptedEmail(candidateEmail, candidateFirstName, recruiterName, recruiterEmail) {
  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `${recruiterName} accepted your connection request`,
    html: `
      <p>Hi ${candidateFirstName},</p>
      <p><strong>${recruiterName}</strong> accepted your connection request on PreCheckd.</p>
      <p>You can now reach them directly at: <strong>${recruiterEmail}</strong></p>
      <p>You can also message them directly through your PreCheckd inbox.</p>
    `,
  });
}

async function sendConnectionDeclinedEmail(candidateEmail, candidateFirstName, recruiterName) {
  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `Update on your connection request`,
    html: `
      <p>Hi ${candidateFirstName},</p>
      <p><strong>${recruiterName}</strong> declined your connection request on PreCheckd.</p>
      <p>Don't be discouraged — keep browsing and connecting with other verified recruiters.</p>
    `,
  });
}

async function sendNewMessageEmail(toEmail, recipientFirstName, senderName, subject) {
  const inboxUrl = `${process.env.APP_BASE_URL}/messages`;

  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: subject ? `New message: ${subject}` : `You have a new message on PreCheckd`,
    html: `
      <p>Hi ${recipientFirstName},</p>
      <p><strong>${senderName}</strong> sent you a message on PreCheckd.</p>
      <p><a href="${inboxUrl}">View it in your inbox</a></p>
    `,
  });
}

module.exports = {
  sendVerificationEmail,
  generateVerificationToken,
  sendLoginEmail,
  sendCandidateLoginCode,
  sendCandidateVerificationLink,
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail,
  sendNewMessageEmail,
  generateSixDigitCode
};