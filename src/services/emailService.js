const nodemailer = require('nodemailer');
const crypto = require('crypto');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function sendVerificationEmail(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/founding-recruiter/verify-email?token=${token}`;

  return transporter.sendMail({
    from: `"PreCheckd" <${process.env.SMTP_USER}>`,
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