// Public side of the free founding year: the personal join link (/join/CODE) and the "request an invite" form.
// Staff approve requests on the staff Invites page (routes/internal.js). Nothing here charges anything.
const express = require('express');
const invites = require('../services/foundingInvites');
const recruiterBilling = require('../services/recruiterBilling');
const emailService = require('../services/emailService');

const router = express.Router();

const PER_HOUR = 5;
const hits = new Map(); // ip -> timestamps (ms); resets on restart, fine for a form this small
function overLimit(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - 60 * 60 * 1000);
  const blocked = list.length >= PER_HOUR;
  if (!blocked) list.push(now);
  hits.set(ip, list);
  return blocked;
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [ip, list] of hits) if (!list.some((t) => t > cutoff)) hits.delete(ip);
}, 60 * 60 * 1000).unref();

// Spots still open in the invite-only step (the first 100). Full means a code can no longer start a free year.
async function spotsLeft() {
  const st = await recruiterBilling.status(new Date(), { invite: true });
  return st.freeDays ? st.spotsLeft : 0;
}

// The personal link. Remembers the code for this visit, then explains the offer before they sign up.
router.get('/join/:code', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const invite = await invites.findUsable(req.params.code);
    const left = invite ? await spotsLeft() : 0;
    if (invite && left > 0) {
      req.session.inviteCode = invite.code;
      // Already signed in: straight to the membership page, where the free year is waiting.
      if (req.session.recruiterId) return res.redirect('/billing');
    }
    res.render('join-invite', {
      pageTitle: 'Your founding invite | PreCheckd', robotsMeta: 'noindex, nofollow',
      state: !invite ? 'invalid' : left > 0 ? 'ok' : 'full',
    });
  } catch (e) {
    console.error('Error loading invite:', e);
    res.status(500).send('Server error');
  }
});

router.get('/request-invite', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.render('request-invite', { pageTitle: 'Request an invite | PreCheckd', robotsMeta: 'noindex, nofollow', done: req.query.sent === '1', error: '', form: {} });
});

router.post('/request-invite', async (req, res) => {
  const b = req.body || {};
  const render = (error) => res.status(400).render('request-invite', { pageTitle: 'Request an invite | PreCheckd', robotsMeta: 'noindex, nofollow', done: false, error, form: b });
  // Hidden field only bots fill in: pretend it worked and save nothing.
  if (typeof b.website === 'string' && b.website.trim()) return res.redirect('/request-invite?sent=1');
  if (overLimit(req.ip)) return render('Too many tries. Please try again later.');
  try {
    const out = await invites.submitRequest({ name: b.name, email: b.email, company: b.company, about: b.about });
    if (out.created) {
      try {
        const adminBase = 'https://' + (process.env.ADMIN_HOSTNAME || 'admin.precheckd.com');
        await emailService.sendStaffAlertEmail({
          subject: 'New founding invite request', headline: 'Someone asked for a founding invite',
          paragraphs: [`${out.invite.name} (${out.invite.email}). Company: ${out.invite.company || 'not given'}.`, out.invite.about ? `They wrote: ${out.invite.about}` : 'They did not add a note.'],
          buttonUrl: adminBase + '/invites', buttonLabel: 'Review requests',
        });
      } catch (e) { console.error('Invite request alert failed:', e.message); }
    }
    res.redirect('/request-invite?sent=1');
  } catch (e) {
    if (e.code === 'bad_name' || e.code === 'bad_email') return render(e.message);
    console.error('Error saving invite request:', e);
    res.status(500).send('Server error');
  }
});

module.exports = router;
