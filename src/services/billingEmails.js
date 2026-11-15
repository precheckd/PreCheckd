// PreCheckd's own membership emails: started, payment trouble (with the date access ends), cancelled, ended.
// Stripe still sends the card receipts and the "your card failed" notice; these say what it means on PreCheckd.
// Sent from the webhook only when the status actually changes, and the webhook itself never repeats an event.
const emailService = require('./emailService');

const BASE = () => process.env.APP_BASE_URL || process.env.BASE_URL || 'https://precheckd.com';

const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

// Pure: which emails a change of billing state calls for. `before` and `after` are { status, cancelAtPeriodEnd }.
function transitions(before, after) {
  const out = [];
  const was = before.status || 'none';
  const now = after.status || 'none';
  if ((was === 'none' || was === 'incomplete') && now === 'active') out.push('started');
  if (was !== 'past_due' && was !== 'unpaid' && (now === 'past_due' || now === 'unpaid')) out.push('payment_trouble');
  if (now === 'active' && !before.cancelAtPeriodEnd && after.cancelAtPeriodEnd) out.push('cancel_scheduled');
  if (now === 'canceled' && was !== 'canceled') out.push('ended');
  return out;
}

// Pure: the words. `who` is 'recruiter' or 'candidate'; `d` carries { graceUntil, periodEnd, plan }.
function notice(kind, who, d = {}) {
  const page = who === 'recruiter' ? '/billing' : '/candidate-billing';
  const plan = d.plan === 'annual' ? 'annual' : 'monthly';
  const what = who === 'recruiter' ? 'post jobs, search candidates and reach your applicants' : 'take skill tests, apply to jobs and keep your profile visible';
  const list = {
    started: {
      subject: 'Welcome: your PreCheckd membership is active',
      headline: 'You are a PreCheckd member',
      paragraphs: [`Your ${plan} membership is active, so you can ${what}. Stripe emails your receipt separately.`, 'You can update your card, see invoices or cancel any time from your membership page.'],
      button: 'Open my membership',
    },
    payment_trouble: {
      subject: 'Action needed: your PreCheckd payment did not go through',
      headline: 'Your payment did not go through',
      paragraphs: [
        d.graceUntil
          ? `Everything stays active until ${fmt(d.graceUntil)} while we keep trying your card. If it is not fixed by then, your membership ends and you will no longer be able to ${what}.`
          : `We will keep trying your card for a few days. If it is not fixed, your membership ends and you will no longer be able to ${what}.`,
        'The quickest fix is to update your card on your membership page.',
      ],
      button: 'Update my card',
    },
    cancel_scheduled: {
      subject: 'Your PreCheckd membership will end',
      headline: 'Your membership is set to end',
      paragraphs: [
        d.periodEnd ? `You keep full access until ${fmt(d.periodEnd)}, and it will not renew after that.` : 'You keep full access until the end of the period you paid for, and it will not renew.',
        'Changed your mind? You can keep your membership from your membership page before then.',
      ],
      button: 'Keep my membership',
    },
    ended: {
      subject: 'Your PreCheckd membership has ended',
      headline: 'Your membership has ended',
      paragraphs: [
        who === 'recruiter'
          ? 'Your job postings are hidden, and search, applicants and outreach are paused until you rejoin. Nothing has been deleted.'
          : 'Your public profile now shows that you are not a member, and skill tests and applying are paused. Your results and profile are saved.',
        'You can rejoin any time from your membership page.',
      ],
      button: 'Rejoin PreCheckd',
    },
  };
  const n = list[kind];
  return n ? Object.assign({}, n, { url: BASE() + page }) : null;
}

// Best effort: a failed email must never fail the webhook.
async function send(kind, who, account, details) {
  try {
    const n = notice(kind, who, details);
    if (!n || !account || !account.email) return false;
    await emailService.sendBillingNoticeEmail(account.email, account.firstName, n);
    return true;
  } catch (e) {
    console.error('Billing email failed:', kind, e.message);
    return false;
  }
}

const stateOf = (b) => ({ status: (b && b.status) || 'none', cancelAtPeriodEnd: Boolean(b && b.cancelAtPeriodEnd) });

// Sends whatever the change from `before` to the account's current billing state calls for.
async function notifyChange(who, account, before) {
  const b = account.billing;
  for (const kind of transitions(before, stateOf(b))) {
    await send(kind, who, account, { graceUntil: b.graceUntil, periodEnd: b.currentPeriodEnd, plan: b.plan });
  }
}

module.exports = { transitions, notice, send, stateOf, notifyChange };
