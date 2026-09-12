const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function sendVerificationEmail(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/founding-recruiter/verify-email?token=${token}`;

  return resend.emails.send({
    from: 'onboarding@resend.dev',
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

module.exports = { sendVerificationEmail, generateVerificationToken };