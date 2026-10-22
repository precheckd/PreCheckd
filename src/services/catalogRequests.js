// Records "we do not have this in the catalog" requests for staff (see models/CatalogRequest.js).
// Never throws: a failure here must not break the member's own save.
const CatalogRequest = require('../models/CatalogRequest');
const { catalogIdFor, normalize } = require('../content/certCatalog');

async function record({ kind, name, detail = '', byType, byId }) {
  try {
    const clean = String(name || '').trim().slice(0, 160);
    const key = normalize(clean);
    if (!key || !byId) return false;
    await CatalogRequest.updateOne(
      { kind, key, requestedById: byId },
      { $setOnInsert: { name: clean, detail: String(detail).slice(0, 400), requestedByType: byType, status: 'requested' } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Could not record catalog request:', error.message);
    return false;
  }
}

// Certifications on a candidate's profile whose names the catalog does not recognize.
function unlistedCertNames(certifications) {
  return (certifications || []).map((c) => c && c.name).filter((n) => n && !catalogIdFor(n));
}

async function recordUnlistedCerts(candidate) {
  const names = unlistedCertNames(candidate.certifications);
  for (const name of names) await record({ kind: 'certification', name, byType: 'candidate', byId: candidate._id });
  return names.length;
}

async function recordMissingTitle(recruiterId, skillLabels) {
  const detail = (skillLabels || []).join(', ');
  return record({ kind: 'job_title', name: detail || 'No skills picked', detail, byType: 'recruiter', byId: recruiterId });
}

module.exports = { record, unlistedCertNames, recordUnlistedCerts, recordMissingTitle };
