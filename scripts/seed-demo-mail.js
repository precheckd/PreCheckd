// Adds (or removes) clearly fake sample messages in a candidate's PreCheckd
// Mail, so the new Mail page can be reviewed before real mail arrives.
//   npm run seed-demo-mail -- <candidate-email>            add sample mail
//   npm run seed-demo-mail -- --remove <candidate-email>   delete the samples
// Sample rows are marked isDemo and use made-up senders on example.com.
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const Candidate = require('../src/models/Candidate');
const MailMessage = require('../src/models/MailMessage');
const Application = require('../src/models/Application');
const { suggestFor } = require('../src/services/applicationTracker');

const args = process.argv.slice(2);
const remove = args[0] === '--remove';
const email = String(remove ? args[1] : args[0] || '').trim().toLowerCase();

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

const SAMPLES = (ownerId) => [
  {
    fromName: 'Dana Whitfield (sample)', fromAddress: 'dana.whitfield@example.com', subject: 'Sample: Senior Support Engineer role',
    textBody: 'This is a sample message from a verified recruiter.\n\nHi, I came across your PreCheckd profile and think you would be a strong fit for a Senior Support Engineer role. Are you open to a short call this week?\n\nThanks,\nDana',
    senderCheck: 'verified_recruiter', recruiterName: 'Dana Whitfield (Sample Staffing)', receivedAt: hoursAgo(2), readAt: null
  },
  {
    fromName: 'Acme Careers (sample)', fromAddress: 'no-reply@careers.example.com', subject: 'Sample: Thanks for applying to Support Engineer at Acme',
    textBody: 'This is a sample application confirmation.\n\nThank you for applying to the Support Engineer position at Acme. We received your application on October 14 and will be in touch if your background is a match.\n\nAcme Talent Team',
    senderCheck: 'unverified', receivedAt: hoursAgo(20), readAt: null
  },
  {
    fromName: 'Globex Recruiting (sample)', fromAddress: 'jobs@globex.example.com', subject: 'Sample: Your application to Cloud Engineer',
    textBody: 'This is a sample message.\n\nWe would like to invite you to complete an online assessment for the Cloud Engineer role. Please use the link in your portal to schedule it.',
    senderCheck: 'unverified', receivedAt: hoursAgo(50), readAt: hoursAgo(40),
    attachments: [{ filename: 'assessment-instructions.pdf', contentType: 'application/pdf', size: 84213 }]
  },
  {
    fromName: 'Quick Hire Now (sample)', fromAddress: 'offers@hire-fast.example.com', subject: 'Sample: URGENT work from home, $60/hr, no interview',
    textBody: 'This is a sample of a suspicious message.\n\nYou are selected! Reply with your SSN and bank details today to receive your signing bonus. Install the remote access tool we send you to begin.',
    senderCheck: 'unverified', flagged: true, flagReason: 'spam_verdict', receivedAt: hoursAgo(6), readAt: null
  }
].map((m) => ({ namespace: 'candidate', ownerId, direction: 'in', isDemo: true, ...m }));

async function main() {
  if (!email) { console.log('Usage: npm run seed-demo-mail -- [--remove] <candidate-email>'); return; }
  const candidate = await Candidate.findOne({ email });
  if (!candidate) { console.log('No candidate with that email.'); return; }

  const gone = await MailMessage.deleteMany({ namespace: 'candidate', ownerId: candidate._id, isDemo: true });
  if (remove) { console.log(`Removed ${gone.deletedCount} sample message(s).`); return; }

  const samples = SAMPLES(candidate._id);
  // Same tracker suggestions real mail would get (skips mail from the flagged scam sample).
  for (const m of samples) {
    if (!m.flagged) {
      const suggestion = await suggestFor({ ownerId: candidate._id, mail: m });
      if (suggestion) m.suggestion = suggestion;
    }
  }
  const docs = await MailMessage.insertMany(samples);
  console.log(`Added ${docs.length} sample messages for ${email}. Open /mail to see them.`);
}

connectDatabase()
  .then(main)
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
