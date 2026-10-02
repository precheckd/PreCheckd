const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);

const MOCK_EMAIL = process.env.MOCK_EMAIL === 'true';

// Every send in this file goes through here instead of calling
// resend.emails.send directly — with MOCK_EMAIL=true, nothing actually
// goes out, it just logs to the console. Use this during testing so you
// can use made-up/fake "reported" addresses without emailing real people,
// the same way MOCK_SMS/MOCK_IDENTITY already work for phone/identity.
async function sendEmail(params) {
  if (MOCK_EMAIL) {
    console.log(`[MOCK EMAIL] To: ${params.to} | Subject: ${params.subject}`);
    console.log(params.html);
    return { mock: true };
  }

  return resend.emails.send(params);
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function sendVerificationEmail(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/founding-recruiter/verify-email?token=${token}`;

  return sendEmail({
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

// Used three ways, all through the same /reset-password/:token page:
//   1. A recruiter or candidate who clicked "Forgot password"
//   2. An account created before passwords existed, getting its one-time
//      migration link to set a password for the first time
//   3. (future) A claim-account invite, once that flow is built
async function sendPasswordResetEmail(toEmail, firstName, token, { isFirstTime = false } = {}) {
  const resetUrl = `${process.env.APP_BASE_URL}/reset-password/${token}`;

  const subject = isFirstTime ? 'Set your PreCheckd password' : 'Reset your PreCheckd password';
  const intro = isFirstTime
    ? `We've moved to password-based logins. Click below to set a password for your PreCheckd account:`
    : `Click the link below to set a new password for your PreCheckd account:`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject,
    html: `
      <p>Hi ${firstName},</p>
      <p>${intro}</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

async function sendCandidateVerificationLink(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/candidate/verify-email?token=${token}`;

  return sendEmail({
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
  return sendEmail({
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
  return sendEmail({
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

  return sendEmail({
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

async function sendFraudReportThankYouEmail(toEmail, couponCode) {
  const candidateLandingUrl = `${process.env.APP_BASE_URL}/candidate-landing`;
  const recruiterSearchUrl = `${process.env.APP_BASE_URL}/recruiter-search`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Thanks for reporting — here\'s what happens next',
    html: `
      <p>Hi,</p>
      <p>Thanks for taking the time to report a suspicious recruiter to PreCheckd. Here's what happens next:</p>
      <ol>
        <li>Your report is logged immediately and checked against every PreCheckd recruiter account.</li>
        <li>If it matches an existing account, that's flagged for review, and depending on the recruiter's verification status, we may reach out to them.</li>
        <li>Our team reviews new reports directly — this isn't fully automated yet, so a real person looks at what you submitted.</li>
      </ol>
      ${couponCode ? `
      <p>As a thank-you, here's a code good for 20% off PreCheckd once our paid features launch:</p>
      <p style="font-size: 1.3em; font-weight: bold; letter-spacing: 0.08em; color: #1F363C;">${couponCode}</p>
      <p>Save this — we'll let you know when it's ready to use.</p>
      ` : ''}
      <p>In the meantime, see how PreCheckd verifies every recruiter before they can reach candidates:</p>
      <p><a href="${candidateLandingUrl}">For Candidates</a> &middot; <a href="${recruiterSearchUrl}">Browse Verified Recruiters</a></p>
    `,
  });
}

// Sent to a recruiter email that was named in a fraud/review report but
// doesn't match any existing PreCheckd account. Not a marketing email and
// never advertised anywhere — the only way anyone gets this is by being
// named in a report. Reuses the same /reset-password/:token page to let
// them set a password and claim the account.
async function sendFraudClaimInviteEmail(toEmail, token) {
  const claimUrl = `${process.env.APP_BASE_URL}/reset-password/${token}`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Someone left feedback about you on PreCheckd',
    html: `
      <p>Hi,</p>
      <p>A candidate submitted feedback on PreCheckd about an experience with a recruiter at this email address.</p>
      <p>Create an account to see what was reported:</p>
      <p><a href="${claimUrl}">${claimUrl}</a></p>
      <p>This link expires in 14 days and can only be used once. If you believe this was sent in error, you can safely ignore it.</p>
    `,
  });
}

// Verifies someone actually owns the email they typed into the public
// fraud report form, before that submission is allowed to do anything
// (create a claim account, email a recruiter, etc.). No account, no
// password — just proof of inbox access for this one submission.
async function sendFraudReporterVerificationEmail(toEmail, code) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Your PreCheckd verification code',
    html: `
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>Enter this code to continue your fraud report. It expires in 10 minutes.</p>
    `,
  });
}

// Sent to an existing, already-active account (standard or a previously
// claimed account — anything with a password set) when a new report names
// them by exact email match. Deliberately neutral: no description of what
// was reported, no verdict, just "something's on file, go look." At most
// one of these per account per 24 hours (see Recruiter.lastFraudNotifiedAt)
// so several same-day reports don't read as a pile-on.
async function sendFraudReportNoticeEmail(toEmail) {
  const loginUrl = `${process.env.APP_BASE_URL}/login`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'A report was filed about your PreCheckd account',
    html: `
      <p>Hi,</p>
      <p>A candidate submitted feedback on PreCheckd mentioning your account. This hasn't been reviewed or verified by PreCheckd — we're letting you know right away, for transparency, so you're aware and have the chance to respond.</p>
      <p><a href="${loginUrl}">Log in to see it</a></p>
    `,
  });
}

// Sent to an unverified/claim account when a candidate runs their email
// through the public Email Checker widget. Not an accusation — just an FYI
// that someone looked them up, plus a nudge to get verified. At most one
// per account per week (see Recruiter.lastLookupNudgeAt), however many
// lookups happen in that window, so it reads as useful rather than spammy.
async function sendLookupNudgeEmail(toEmail) {
  const loginUrl = `${process.env.APP_BASE_URL}/login`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Someone looked up your email on PreCheckd',
    html: `
      <p>Hi,</p>
      <p>A candidate recently used PreCheckd's Email Checker tool to look into this email address. This isn't a report or any kind of accusation — candidates use this tool to research recruiters before responding to outreach.</p>
      <p>If you're a legitimate recruiter, getting verified on PreCheckd is the fastest way to show candidates you're trustworthy before they decide whether to engage.</p>
      <p><a href="${loginUrl}">Log in or get verified</a></p>
    `,
  });
}

// The admin login's second factor — sent to Kent directly rather than
// through SMS (which this reuses from the recruiter/candidate phone-
// verification path and depends on the destination number not being on
// AWS's opt-out suppression list, which turned out to be an issue here).
// Email doesn't have that failure mode, so it's the more reliable second
// factor for a single-admin login like this one.
async function sendAdminLoginCodeEmail(code) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: 'kent@precheckd.com',
    subject: 'Your PreCheckd admin login code',
    html: `
      <p>Your admin login code is: <strong>${code}</strong></p>
      <p>Enter this on the login page to finish signing in. It expires in 10 minutes.</p>
    `,
  });
}

// Sent to Kent directly (not a recruiter/candidate notice) when an IP hits
// the admin-login rate limit — a burst of wrong passwords/codes against
// the one shared admin secret. Debounced per IP so it's one heads-up per
// hour of continued hammering, not one email per rejected attempt.
async function sendAdminLoginAlertEmail(ip, attemptCount) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: 'kent@precheckd.com',
    subject: 'Repeated failed admin logins on PreCheckd',
    html: `
      <p>An IP address (${ip}) has made ${attemptCount} failed attempts against the internal admin login in the past hour and is now rate-limited.</p>
      <p>No action needed unless this keeps happening — the shared secret and SMS code are both still required either way.</p>
    `,
  });
}

module.exports = {
  sendVerificationEmail,
  sendFraudClaimInviteEmail,
  sendFraudReportNoticeEmail,
  sendFraudReporterVerificationEmail,
  generateVerificationToken,
  sendPasswordResetEmail,
  sendCandidateVerificationLink,
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail,
  sendNewMessageEmail,
  sendFraudReportThankYouEmail,
  sendLookupNudgeEmail,
  sendAdminLoginAlertEmail,
  sendAdminLoginCodeEmail,
  generateSixDigitCode
};