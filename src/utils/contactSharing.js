// Contact info (email/phone) is hidden between a recruiter and candidate
// even after a connection is accepted. A party only ever sees the other
// side's email/phone if the other side chose to share it through the
// contact request flow in messaging. Everything that displays the other
// party's contact details goes through here so the rule lives in one place.

const CONTACT_WARNING_TITLE = 'Before you take this conversation off PreCheckd';

const CONTACT_WARNING_POINTS = [
  'Messages on PreCheckd happen between identity-verified people. Off the platform, that verification no longer protects you.',
  'You lose PreCheckd\'s scam checking and reporting tools, and the record of this conversation.',
  'Never send money, pay a "fee," or share your SSN, bank, or card details with anyone you\'ve met online, however legitimate they seem.',
  'Anything you share can\'t be taken back.'
];

function otherSide(viewerType) {
  return viewerType === 'candidate' ? 'recruiter' : 'candidate';
}

// What the viewer is allowed to see of the OTHER party's contact details:
// { email, phone, sharedAt } with null for anything not shared, or null if
// nothing at all has been shared.
function sharedContactFor(connection, viewerType, otherParty) {
  if (!connection || !otherParty) return null;
  const shared = connection.contactShared && connection.contactShared[otherSide(viewerType)];
  if (!shared || (!shared.email && !shared.phone)) return null;

  return {
    email: shared.email ? otherParty.email || null : null,
    phone: shared.phone ? otherParty.phone || null : null,
    sharedAt: shared.sharedAt || null
  };
}

function hasSharedAnything(connection, side) {
  const shared = connection && connection.contactShared && connection.contactShared[side];
  return Boolean(shared && (shared.email || shared.phone));
}

module.exports = {
  CONTACT_WARNING_TITLE,
  CONTACT_WARNING_POINTS,
  otherSide,
  sharedContactFor,
  hasSharedAnything
};
