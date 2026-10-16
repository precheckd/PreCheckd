const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Application = require('../models/Application');
const MailMessage = require('../models/MailMessage');
const { acceptSuggestion } = require('../services/applicationTracker');

// The candidate application tracker (roadmap #5). Entries are added by hand or
// from a mail suggestion the member confirms; every status change is the
// member's choice, and the history records which mail prompted it.

const { STATUSES } = Application;
const STATUS_LABELS = {
  applied: 'Applied', screening: 'Screening', interviewing: 'Interviewing',
  offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn'
};
const ACTIVE = ['applied', 'screening', 'interviewing', 'offer'];
const NO_REPLY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function requireCandidate(req, res, next) {
  if (req.session.candidateId) return next();
  if (req.session.recruiterId) return res.redirect('/messages');
  return res.redirect('/login');
}
router.use(requireCandidate);

// "2026-10-15" from a date input -> noon UTC that day (so no timezone can shift
// the calendar date). Blank -> null; anything else -> undefined (invalid).
function parseDay(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Only http(s) links are kept, so a stored link can never be a javascript: URL.
function cleanUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return /^https?:\/\/[^\s]+$/i.test(v) ? v.slice(0, 500) : undefined;
}

function text(value, max) {
  return String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

// Validates the shared form fields. Returns { values } or { error }.
function readForm(body) {
  const company = text(body.company, 120);
  if (!company) return { error: 'Company is required.' };
  const status = STATUSES.includes(body.status) ? body.status : 'applied';
  const appliedAt = parseDay(body.appliedAt);
  const interviewAt = parseDay(body.interviewAt);
  if (appliedAt === undefined || interviewAt === undefined) return { error: 'Dates must look like 2026-10-15.' };
  const jobUrl = cleanUrl(body.jobUrl);
  if (jobUrl === undefined) return { error: 'The job link must start with http:// or https://.' };
  return {
    values: {
      company, status, appliedAt, interviewAt, jobUrl,
      roleTitle: text(body.roleTitle, 160),
      reqId: text(body.reqId, 80),
      resumeUsed: text(body.resumeUsed, 160),
      jobDescription: text(body.jobDescription, 20000),
      notes: text(body.notes, 5000)
    }
  };
}

function decorate(app) {
  const days = Math.floor((Date.now() - new Date(app.lastActivityAt).getTime()) / DAY_MS);
  return {
    id: app._id.toString(),
    company: app.company,
    roleTitle: app.roleTitle,
    status: app.status,
    statusLabel: STATUS_LABELS[app.status],
    appliedAt: app.appliedAt,
    interviewAt: app.interviewAt,
    lastActivityAt: app.lastActivityAt,
    // A display hint only; it never changes the status.
    noReply: app.status === 'applied' && days >= NO_REPLY_DAYS,
    daysQuiet: days
  };
}

function suggestionCard(mail) {
  const s = mail.suggestion;
  return {
    mailId: mail._id.toString(),
    subject: mail.subject || '(no subject)',
    from: mail.fromName || mail.fromAddress,
    receivedAt: mail.receivedAt,
    action: s.action,
    kind: s.kind,
    company: s.company || '',
    role: s.role || '',
    status: s.status,
    statusLabel: STATUS_LABELS[s.status],
    applicationId: s.applicationId ? s.applicationId.toString() : null
  };
}

async function pendingSuggestions(candidateId) {
  const mails = await MailMessage.find({
    namespace: 'candidate', ownerId: candidateId, direction: 'in', deletedAt: null, 'suggestion.state': 'pending'
  }).sort({ receivedAt: -1 }).limit(50);
  return mails.map(suggestionCard);
}

function renderTracker(req, res, extra = {}) {
  return res.render('tracker', { pageTitle: 'Application tracker | PreCheckd', STATUSES, STATUS_LABELS, ...extra });
}

// GET /tracker?filter=active|all|rejected|withdrawn
router.get('/', async (req, res) => {
  try {
    const candidateId = req.session.candidateId;
    const filter = ['active', 'all', 'rejected', 'withdrawn'].includes(req.query.filter) ? req.query.filter : 'active';
    const [apps, suggestions] = await Promise.all([
      Application.find({ candidateId }).sort({ lastActivityAt: -1 }).limit(1000),
      pendingSuggestions(candidateId)
    ]);

    const counts = {
      active: apps.filter((a) => ACTIVE.includes(a.status)).length,
      all: apps.length,
      rejected: apps.filter((a) => a.status === 'rejected').length,
      withdrawn: apps.filter((a) => a.status === 'withdrawn').length
    };
    const shown = apps.filter((a) => (filter === 'all' ? true : filter === 'active' ? ACTIVE.includes(a.status) : a.status === filter));

    return renderTracker(req, res, {
      rows: shown.map(decorate),
      suggestions,
      filter,
      counts,
      error: null,
      form: {},
      added: req.query.added === '1'
    });
  } catch (error) {
    console.error('Error loading tracker:', error);
    return res.status(500).send('Server error');
  }
});

// POST /tracker/new — add an application by hand
router.post('/new', async (req, res) => {
  try {
    const parsed = readForm(req.body);
    if (parsed.error) {
      const candidateId = req.session.candidateId;
      const [apps, suggestions] = await Promise.all([
        Application.find({ candidateId }).sort({ lastActivityAt: -1 }).limit(1000),
        pendingSuggestions(candidateId)
      ]);
      return renderTracker(req, res.status(400), {
        rows: apps.filter((a) => ACTIVE.includes(a.status)).map(decorate), suggestions, filter: 'active',
        counts: {
          active: apps.filter((a) => ACTIVE.includes(a.status)).length, all: apps.length,
          rejected: apps.filter((a) => a.status === 'rejected').length, withdrawn: apps.filter((a) => a.status === 'withdrawn').length
        },
        error: parsed.error, form: req.body || {}, added: false
      });
    }
    const v = parsed.values;
    const app = await Application.create({
      candidateId: req.session.candidateId,
      ...v,
      source: 'manual',
      history: [{ at: new Date(), status: v.status, by: 'created' }],
      lastActivityAt: new Date()
    });
    return res.redirect(`/tracker/${app._id}?saved=1`);
  } catch (error) {
    console.error('Error adding application:', error);
    return res.status(500).send('Server error');
  }
});

// POST /tracker/suggestions/:mailId/accept — the member confirmed (and maybe edited) a suggestion
router.post('/suggestions/:mailId/accept', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.mailId)) return res.status(404).send('Not found.');
    const mail = await MailMessage.findOne({
      _id: req.params.mailId, namespace: 'candidate', ownerId: req.session.candidateId, direction: 'in', deletedAt: null
    });
    if (!mail || !mail.suggestion || mail.suggestion.state !== 'pending') return res.redirect('/tracker');

    const result = await acceptSuggestion({
      ownerId: req.session.candidateId,
      mail,
      overrides: {
        company: text(req.body.company, 120) || undefined,
        role: req.body.role === undefined ? undefined : text(req.body.role, 160),
        status: req.body.status
      }
    });
    if (result.error) return res.redirect(req.body.returnTo === 'mail' ? `/mail/${mail._id}` : '/tracker');
    return res.redirect(`/tracker/${result.application._id}?saved=1`);
  } catch (error) {
    console.error('Error accepting tracker suggestion:', error);
    return res.status(500).send('Server error');
  }
});

// POST /tracker/suggestions/:mailId/dismiss
router.post('/suggestions/:mailId/dismiss', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.mailId)) return res.status(404).send('Not found.');
    const mail = await MailMessage.findOne({
      _id: req.params.mailId, namespace: 'candidate', ownerId: req.session.candidateId, direction: 'in'
    });
    if (mail && mail.suggestion && mail.suggestion.state === 'pending') {
      mail.suggestion.state = 'dismissed';
      await mail.save();
    }
    return res.redirect(req.body.returnTo === 'mail' && mail ? `/mail/${mail._id}` : '/tracker');
  } catch (error) {
    console.error('Error dismissing tracker suggestion:', error);
    return res.status(500).send('Server error');
  }
});

async function loadEntry(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return Application.findOne({ _id: req.params.id, candidateId: req.session.candidateId });
}

async function renderEntry(req, res, app, { error = null, status = 200 } = {}) {
  const mails = app.mailIds.length > 0
    ? await MailMessage.find({
      _id: { $in: app.mailIds }, namespace: 'candidate', ownerId: req.session.candidateId, deletedAt: null
    }).sort({ receivedAt: -1 })
    : [];
  const mailById = new Map(mails.map((m) => [m._id.toString(), m]));
  const history = [...app.history].reverse().map((h) => ({
    at: h.at, status: h.status, statusLabel: STATUS_LABELS[h.status], by: h.by, note: h.note,
    mail: h.mailId && mailById.get(h.mailId.toString())
      ? { id: h.mailId.toString(), subject: mailById.get(h.mailId.toString()).subject || '(no subject)' }
      : null
  }));
  return res.status(status).render('tracker-entry', {
    pageTitle: `${app.company} | Application tracker`,
    app,
    STATUSES,
    STATUS_LABELS,
    history,
    mails: mails.map((m) => ({ id: m._id.toString(), subject: m.subject || '(no subject)', from: m.fromName || m.fromAddress, at: m.receivedAt })),
    error,
    saved: req.query.saved === '1'
  });
}

// GET /tracker/:id
router.get('/:id', async (req, res) => {
  try {
    const app = await loadEntry(req);
    if (!app) return res.status(404).send('Application not found.');
    return renderEntry(req, res, app);
  } catch (error) {
    console.error('Error loading application:', error);
    return res.status(500).send('Server error');
  }
});

// POST /tracker/:id — save edits
router.post('/:id', async (req, res) => {
  try {
    const app = await loadEntry(req);
    if (!app) return res.status(404).send('Application not found.');

    const parsed = readForm(req.body);
    if (parsed.error) return renderEntry(req, res, app, { error: parsed.error, status: 400 });
    const v = parsed.values;

    const statusChanged = v.status !== app.status;
    Object.assign(app, v);
    if (statusChanged) app.history.push({ at: new Date(), status: v.status, by: 'you' });
    app.lastActivityAt = new Date();
    await app.save();
    return res.redirect(`/tracker/${app._id}?saved=1`);
  } catch (error) {
    console.error('Error saving application:', error);
    return res.status(500).send('Server error');
  }
});

// POST /tracker/:id/delete
router.post('/:id/delete', async (req, res) => {
  try {
    const app = await loadEntry(req);
    if (!app) return res.status(404).send('Application not found.');
    await Application.deleteOne({ _id: app._id });
    return res.redirect('/tracker');
  } catch (error) {
    console.error('Error deleting application:', error);
    return res.status(500).send('Server error');
  }
});

module.exports = router;
