// In the demo, a recruiter's access requests are approved on the spot, so a visitor sees the same steps as the
// real flow without a second person: connection request -> accepted, full-access request -> granted.
// The sample contact details are fake (…@demo.invalid, 555 numbers) and nothing is ever sent.
const demo = require('../config/demo');
const ConnectionRequest = require('../models/ConnectionRequest');

// Called right after a recruiter-initiated connection request is created.
async function approveConnection(candidateId, recruiterId) {
  if (!demo.enabled()) return null;
  const now = new Date();
  return ConnectionRequest.findOneAndUpdate(
    { candidateId, recruiterId, status: 'pending' },
    { $set: { status: 'accepted', respondedAt: now, 'contactShared.candidate.email': true, 'contactShared.candidate.phone': true, 'contactShared.candidate.sharedAt': now } },
    { new: true }
  );
}

// Called with the request after it was moved to 'requested'.
async function grantFullAccess(request) {
  if (!demo.enabled() || !request) return request;
  request.fullAccessStatus = 'granted';
  request.fullAccessRespondedAt = new Date();
  await request.save();
  return request;
}

module.exports = { approveConnection, grantFullAccess };
