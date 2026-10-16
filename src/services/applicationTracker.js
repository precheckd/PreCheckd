// Tracker logic that touches the database (roadmap #5): turning a received mail
// into a SUGGESTION, and applying a suggestion the member confirmed. The reading
// itself lives in utils/applicationParser.js (pure rules, no database).
//
// Nothing here changes a tracker entry on its own. suggestFor() only produces
// the suggestion stored on the mail; acceptSuggestion() runs when the member
// clicks Confirm.
const Application = require('../models/Application');
const { parseMail, matchApplication, employerDomain, norm } = require('../utils/applicationParser');

const RANK = { applied: 0, screening: 1, interviewing: 2, offer: 3 };

// Builds the suggestion for one received mail, or null. Never throws: a failure
// here must not stop mail from being delivered.
async function suggestFor({ ownerId, mail }) {
  try {
    const parsed = parseMail(mail);
    if (!parsed || !parsed.company) return null;

    const apps = await Application.find({ candidateId: ownerId })
      .select('company roleTitle status senderDomain messageIds');

    if (parsed.kind === 'application_received') {
      const known = apps.find((a) =>
        norm(a.company) === norm(parsed.company)
        && (!parsed.role || !a.roleTitle || norm(a.roleTitle) === norm(parsed.role)));
      if (known) return null; // already on the tracker
      return { action: 'new_application', kind: parsed.kind, company: parsed.company, role: parsed.role, status: 'applied', state: 'pending' };
    }

    const match = matchApplication(mail, apps);
    if (match) {
      if (match.status === parsed.status) return null;
      // Don't suggest a step backwards (an "assessment" mail after they are already interviewing).
      const live = match.status in RANK;
      if (live && parsed.status in RANK && RANK[parsed.status] <= RANK[match.status]) return null;
      return {
        action: 'status_change', kind: parsed.kind, company: match.company, role: match.roleTitle || parsed.role,
        status: parsed.status, applicationId: match._id, state: 'pending'
      };
    }
    // Interview/rejection/offer mail about a job that was never tracked: offer to add it.
    return { action: 'new_application', kind: parsed.kind, company: parsed.company, role: parsed.role, status: parsed.status, state: 'pending' };
  } catch (err) {
    console.error('[tracker] could not build a suggestion:', err.message);
    return null;
  }
}

function pushHistory(app, status, by, mailId, note) {
  app.history.push({ at: new Date(), status, by, mailId: mailId || null, note: note || null });
}

// Applies a pending suggestion. `mail` is the MailMessage document (owned by
// ownerId); `overrides` are the member's edits { company, role, status }.
// Returns { application } or { error }.
async function acceptSuggestion({ ownerId, mail, overrides = {} }) {
  const sug = mail.suggestion;
  if (!sug || !sug.action || sug.state !== 'pending') return { error: 'no_suggestion' };

  const status = Application.STATUSES.includes(overrides.status) ? overrides.status : sug.status;
  let app;

  if (sug.action === 'status_change' && sug.applicationId) {
    app = await Application.findOne({ _id: sug.applicationId, candidateId: ownerId });
    if (!app) return { error: 'application_missing' };
    app.status = status;
    pushHistory(app, status, 'mail', mail._id);
  } else {
    const company = String(overrides.company || sug.company || '').trim().slice(0, 120);
    if (!company) return { error: 'company_required' };
    app = new Application({
      candidateId: ownerId,
      company,
      roleTitle: String(overrides.role !== undefined ? overrides.role : (sug.role || '')).trim().slice(0, 160),
      status,
      appliedAt: sug.kind === 'application_received' ? mail.receivedAt : null,
      source: 'mail'
    });
    pushHistory(app, status, 'created', mail._id, 'Added from an email');
  }

  const domain = employerDomain(mail.fromAddress);
  if (domain && !app.senderDomain) app.senderDomain = domain;
  if (mail.messageIdHeader && !app.messageIds.includes(mail.messageIdHeader)) app.messageIds.push(mail.messageIdHeader);
  if (!app.mailIds.some((id) => String(id) === String(mail._id))) app.mailIds.push(mail._id);
  app.lastActivityAt = new Date();
  await app.save();

  mail.suggestion.state = 'accepted';
  mail.suggestion.applicationId = app._id;
  await mail.save();
  return { application: app };
}

module.exports = { suggestFor, acceptSuggestion, RANK };
