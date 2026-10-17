const Notification = require('../models/Notification');

// Fire-and-forget: a notification problem must never break the real action.
async function notify(ownerType, ownerId, type, title, url) {
  try {
    if (!ownerId) return null;
    return await Notification.create({ ownerType, ownerId, type, title, url: url || '/connections' });
  } catch (err) {
    console.error('notify failed:', err.message);
    return null;
  }
}

function ago(date, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

async function latestFor(ownerType, ownerId, limit = 10) {
  const [items, unread] = await Promise.all([
    Notification.find({ ownerType, ownerId }).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ ownerType, ownerId, readAt: null })
  ]);
  return {
    unread,
    items: items.map((n) => ({ id: String(n._id), title: n.title, ago: ago(n.createdAt), unread: !n.readAt }))
  };
}

module.exports = { notify, latestFor, ago };
