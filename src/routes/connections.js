const express = require('express');
const router = express.Router();
const ConnectionRequest = require('../models/ConnectionRequest');
const SavedRecruiter = require('../models/SavedRecruiter');
const RelationshipNote = require('../models/RelationshipNote');
const Recruiter = require('../models/Recruiter');

const MAX_NOTE_LENGTH = 1000;

// Connections is the address-book side of the relationship; the Requests
// page (candidate-dashboard / recruiter-dashboard /requests) is where
// pending, declined and in-flight requests live. An entry here is either
// an accepted connection (a request accepted in either direction) or — for
// candidates — a saved recruiter, merged into one entry per person with one
// private note each. Notes are never visible to the other party.

function requireLogin(req, res, next) {
  if (req.session.candidateId || req.session.recruiterId) return next();
  if (req.method === 'GET') return res.redirect('/login');
  return res.status(403).json({ error: 'You must be logged in.' });
}

router.use(requireLogin);

function realCompany(company) {
  return company && company !== 'Not provided' ? company : null;
}

// GET /connections
router.get('/', async (req, res) => {
  try {
    if (req.session.candidateId) {
      return await renderCandidateConnections(req, res);
    }
    return await renderRecruiterConnections(req, res);
  } catch (error) {
    console.error('Error loading connections:', error);
    res.status(500).send('Server error');
  }
});

async function renderCandidateConnections(req, res) {
  const candidateId = req.session.candidateId;

  const [accepted, saved, notes] = await Promise.all([
    ConnectionRequest.find({ candidateId, status: 'accepted' })
      .sort({ respondedAt: -1, createdAt: -1 })
      .populate('recruiterId'),
    SavedRecruiter.find({ candidateId }).populate('recruiterId'),
    RelationshipNote.find({ ownerType: 'candidate', ownerId: candidateId })
  ]);

  const noteByRecruiter = new Map(notes.map((n) => [n.otherId.toString(), n.note]));
  const entries = new Map();

  const entryFor = (recruiter) => {
    const id = recruiter._id.toString();
    if (!entries.has(id)) {
      entries.set(id, {
        key: recruiter.slug,
        name: `${recruiter.firstName} ${recruiter.lastName}`,
        company: realCompany(recruiter.company),
        slug: recruiter.slug,
        photoUrl: recruiter.profilePhotoUrl || null,
        initials: `${(recruiter.firstName || '?').charAt(0)}${(recruiter.lastName || '').charAt(0)}`.toUpperCase(),
        email: null,
        connected: false,
        connectedAt: null,
        requestId: null,
        saved: false,
        savedAt: null,
        // Falls back to the note captured when they saved the recruiter,
        // until they've edited it here.
        note: noteByRecruiter.has(id) ? noteByRecruiter.get(id) : ''
      });
    }
    return entries.get(id);
  };

  accepted.forEach((r) => {
    if (!r.recruiterId) return;
    const entry = entryFor(r.recruiterId);
    if (!entry.connected) {
      entry.connected = true;
      entry.connectedAt = r.respondedAt || r.createdAt;
      entry.requestId = r._id.toString();
      entry.email = r.recruiterId.email;
    }
  });

  saved.forEach((s) => {
    if (!s.recruiterId) return;
    const entry = entryFor(s.recruiterId);
    entry.saved = true;
    entry.savedAt = s.savedAt;
    if (!noteByRecruiter.has(s.recruiterId._id.toString()) && s.note) {
      entry.note = s.note;
    }
  });

  const list = Array.from(entries.values()).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  res.render('connections', {
    isCandidate: true,
    entries: list,
    title: 'Connections | PreCheckd'
  });
}

async function renderRecruiterConnections(req, res) {
  const recruiterId = req.session.recruiterId;

  const recruiter = await Recruiter.findById(recruiterId);
  if (!recruiter) return res.redirect('/login');
  // A claim account has no real connections yet.
  if (recruiter.accountTier === 'unverified_claim') {
    return res.redirect('/recruiter-dashboard/claim');
  }

  const [accepted, notes] = await Promise.all([
    ConnectionRequest.find({ recruiterId, status: 'accepted' })
      .sort({ respondedAt: -1, createdAt: -1 })
      .populate('candidateId'),
    RelationshipNote.find({ ownerType: 'recruiter', ownerId: recruiterId })
  ]);

  const noteByCandidate = new Map(notes.map((n) => [n.otherId.toString(), n.note]));
  const entries = new Map();

  accepted.forEach((r) => {
    const candidate = r.candidateId;
    if (!candidate) return;
    const id = candidate._id.toString();
    if (entries.has(id)) return; // most recent accepted request wins

    entries.set(id, {
      key: r._id.toString(),
      name: `${candidate.firstName} ${candidate.lastName}`,
      company: null,
      slug: null,
      photoUrl: candidate.profilePhotoUrl || null,
      initials: `${(candidate.firstName || '?').charAt(0)}${(candidate.lastName || '').charAt(0)}`.toUpperCase(),
      email: candidate.email,
      connected: true,
      connectedAt: r.respondedAt || r.createdAt,
      requestId: r._id.toString(),
      saved: false,
      savedAt: null,
      note: noteByCandidate.get(id) || ''
    });
  });

  const list = Array.from(entries.values()).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  res.render('connections', {
    isCandidate: false,
    entries: list,
    title: 'Connections | PreCheckd'
  });
}

// POST /connections/note — save the owner's private note on one entry.
// Candidates identify an entry by recruiter slug; recruiters by the
// accepted connection request's id (candidate slugs aren't exposed to
// recruiters). Either way the note is only writable for someone who is
// actually in that person's address book.
router.post('/note', async (req, res) => {
  try {
    const { key } = req.body;
    const raw = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    const note = raw.slice(0, MAX_NOTE_LENGTH);

    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'Missing entry.' });
    }

    let ownerType;
    let ownerId;
    let otherId;

    if (req.session.candidateId) {
      ownerType = 'candidate';
      ownerId = req.session.candidateId;

      const recruiter = await Recruiter.findOne({ slug: key });
      if (!recruiter) return res.status(404).json({ error: 'Not found.' });

      const [connected, saved] = await Promise.all([
        ConnectionRequest.exists({ candidateId: ownerId, recruiterId: recruiter._id, status: 'accepted' }),
        SavedRecruiter.exists({ candidateId: ownerId, recruiterId: recruiter._id })
      ]);
      if (!connected && !saved) return res.status(403).json({ error: 'Not in your Connections.' });

      otherId = recruiter._id;
    } else {
      ownerType = 'recruiter';
      ownerId = req.session.recruiterId;

      const request = await ConnectionRequest.findById(key).catch(() => null);
      if (!request || request.recruiterId.toString() !== ownerId || request.status !== 'accepted') {
        return res.status(403).json({ error: 'Not in your Connections.' });
      }

      otherId = request.candidateId;
    }

    // An emptied note is stored as '' rather than deleted, so clearing a
    // candidate's note doesn't let the older note captured at save time
    // (SavedRecruiter.note) resurface as the fallback.
    await RelationshipNote.findOneAndUpdate(
      { ownerType, ownerId, otherId },
      { note, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving connection note:', error);
    res.status(500).json({ error: 'Something went wrong saving your note.' });
  }
});

module.exports = router;
