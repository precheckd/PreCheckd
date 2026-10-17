const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');

function who(req) {
  if (req.session.candidateId) return { ownerType: 'candidate', ownerId: req.session.candidateId };
  if (req.session.recruiterId) return { ownerType: 'recruiter', ownerId: req.session.recruiterId };
  return null;
}

router.get('/open/:id', async (req, res) => {
  const me = who(req);
  if (!me) return res.redirect('/login');
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...me },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    const url = n && typeof n.url === 'string' && n.url.startsWith('/') && !n.url.startsWith('//') ? n.url : '/connections';
    return res.redirect(url);
  } catch (err) {
    return res.redirect('/connections');
  }
});

router.post('/read-all', async (req, res) => {
  const me = who(req);
  if (!me) return res.redirect('/login');
  try {
    await Notification.updateMany({ ...me, readAt: null }, { $set: { readAt: new Date() } });
  } catch (err) { console.error('read-all failed:', err.message); }
  const back = req.get('referer');
  let dest = '/';
  try { if (back) { const u = new URL(back); dest = u.pathname + u.search; } } catch (e) {}
  res.redirect(dest);
});

module.exports = router;
