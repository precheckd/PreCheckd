// Delete my account: everything is removed, nothing is archived. Cancelling a membership and deleting the account
// are the same thing here; coming back means starting from scratch.
//
// What stays: Stripe keeps its own payment records (we ask it to delete the customer, which also cancels any
// subscription), the email suppression list (bounces, so we never mail a bad address), reports other people made
// about this account (safety), and one hashed record (models/DeletedAccount) so a suspended account cannot
// re-register and a one-time offer cannot be claimed twice.
const mongoose = require('mongoose');
const DeletedAccount = require('../models/DeletedAccount');
const { emailHash, phoneHash } = require('../utils/accountHash');

const M = (name) => require(`../models/${name}`);
const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Models that belong to a candidate, with the field that points at them.
const CANDIDATE_OWNED = [
  ['Application', 'candidateId'], ['CreditRequest', 'candidateId'], ['FinalistTest', 'candidateId'],
  ['JobApplication', 'candidateId'], ['JobInvite', 'candidateId'], ['JobNotice', 'candidateId'],
  ['SkillRequest', 'candidateId'], ['SkillResult', 'candidateId'], ['TestRequest', 'candidateId'],
  ['ProfileView', 'candidateId'], ['SavedRecruiter', 'candidateId'],
];
const RECRUITER_OWNED = [
  ['JobPosting', 'recruiterId'], ['JobDraft', 'recruiterId'], ['JobApplication', 'recruiterId'], ['JobInvite', 'recruiterId'],
  ['FinalistTest', 'recruiterId'], ['TestRequest', 'recruiterId'], ['OutreachMessage', 'recruiterId'],
  ['OutreachBlock', 'recruiterId'], ['ProfileView', 'recruiterId'], ['SavedRecruiter', 'recruiterId'],
];
// Models keyed by ownerId (shared by both kinds).
const OWNER_KEYED = ['BillingEvent', 'FeedItem', 'InboundEmail', 'MailAlias', 'MailBlock', 'MailMessage', 'MailReport', 'Notification', 'PageView', 'RelationshipNote'];

function fileUrls(kind, doc) {
  const urls = [doc.profilePhotoUrl, doc.introVideoUrl];
  if (kind === 'candidate') urls.push(doc.resumeUrl, doc.videoUrl, ...(doc.interviewVideos || []).map((v) => v && v.videoUrl));
  return urls.filter(Boolean);
}

// Removes the account. Stripe goes first: if it fails nothing else is touched, so the person is never left with
// data deleted but a card still being charged.
async function deleteAccount(kind, doc, { stripe, s3 } = {}) {
  if (kind !== 'candidate' && kind !== 'recruiter') throw new Error('Unknown account kind');
  const id = oid(doc._id);
  const billing = doc.billing || {};

  if (stripe && billing.customerId) await stripe.customers.del(billing.customerId);
  // Ask Stripe to erase the ID images and selfie it holds for this person's check (best effort).
  if (stripe && doc.stripeVerificationSessionId && stripe.identity && stripe.identity.verificationSessions) {
    try { await stripe.identity.verificationSessions.redact(doc.stripeVerificationSessionId); } catch (e) { /* already redacted or not redactable */ }
  }

  const tombstone = {
    kind, emailHash: emailHash(doc.email), phoneHash: phoneHash(doc.phone),
    blocked: kind === 'recruiter' && doc.isSuspended === true,
    hadFreeYear: !!(billing.freeYear && billing.freeYear.startedAt),
    hadWaivedFee: !!(billing.verificationFee && billing.verificationFee.waived),
  };

  // Files: public-bucket uploads, then verification-case documents in the private bucket.
  if (s3) {
    for (const url of fileUrls(kind, doc)) { try { await s3.deleteS3Object(url); } catch (e) { console.error('File delete failed:', e.message); } }
  }

  const ownedLinks = kind === 'candidate' ? CANDIDATE_OWNED : RECRUITER_OWNED;
  const connections = await M('ConnectionRequest').find({ [kind === 'candidate' ? 'candidateId' : 'recruiterId']: id }).select('_id');
  const connIds = connections.map((c) => c._id);

  if (kind === 'candidate') {
    const cases = await M('VerificationCase').find({ candidateId: id });
    const caseIds = cases.map((c) => c._id);
    const msgs = await M('Message').find({ $or: [{ connectionRequestId: { $in: connIds } }, { verificationCaseId: { $in: caseIds } }] }).select('attachments');
    if (s3) {
      for (const m of msgs) for (const a of m.attachments || []) { try { await s3.deletePrivateObject(a.key); } catch (e) { console.error('File delete failed:', e.message); } }
    }
    await M('Message').deleteMany({ verificationCaseId: { $in: caseIds } });
    await M('VerificationCase').deleteMany({ candidateId: id });
    await M('CatalogRequest').deleteMany({ requestedByType: 'candidate', requestedById: id });
    await M('FraudReport').updateMany({ reporterCandidateId: id }, { $set: { reporterCandidateId: null, reporterEmail: 'deleted@deleted.invalid' } });
  } else {
    await M('CatalogRequest').deleteMany({ requestedByType: 'recruiter', requestedById: id });
    await M('FoundingInvite').updateMany({ redeemedBy: id }, { $set: { redeemedBy: null, name: '', email: '', company: '', about: '', note: '' } });
    await M('FraudReport').updateMany({ matchedRecruiterId: id }, { $set: { matchedRecruiterId: null } });
  }

  await M('Message').deleteMany({ connectionRequestId: { $in: connIds } });
  await M('ConnectionRequest').deleteMany({ _id: { $in: connIds } });
  for (const [model, field] of ownedLinks) await M(model).deleteMany({ [field]: id });
  for (const model of OWNER_KEYED) await M(model).deleteMany({ ownerId: id });

  await DeletedAccount.create(tombstone);
  await doc.constructor.deleteOne({ _id: id });
  return { ok: true };
}

// Has someone with this email or phone deleted an account before? { blocked, hadFreeYear, hadWaivedFee } or null.
async function previous({ email, phone } = {}) {
  const ors = [];
  if (email) ors.push({ emailHash: emailHash(email) });
  const ph = phoneHash(phone);
  if (ph) ors.push({ phoneHash: ph });
  if (!ors.length) return null;
  const rows = await DeletedAccount.find({ $or: ors });
  if (!rows.length) return null;
  return { blocked: rows.some((r) => r.blocked), hadFreeYear: rows.some((r) => r.hadFreeYear), hadWaivedFee: rows.some((r) => r.hadWaivedFee) };
}

module.exports = { deleteAccount, previous, CANDIDATE_OWNED, RECRUITER_OWNED, OWNER_KEYED };
