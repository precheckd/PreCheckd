// The hiring company's own website: cleaned to a bare domain, and checked for a brand-new domain (flag only, never blocks).
const SOCIAL = /(^|\.)(linkedin|facebook|instagram|twitter|x|tiktok|youtube|indeed|glassdoor|ziprecruiter|monster|gmail|yahoo|outlook|hotmail|google|github|wixsite|linktr\.ee|bit\.ly)\.(com|co|ee|ly)$/i;

function normalizeSite(input) {
  let t = String(input || '').trim().toLowerCase();
  if (!t || /\s/.test(t) || t.includes('@')) return null;
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\d?\./, '');
  const host = t.split(/[/?#:]/)[0];
  if (!/^(?=.{4,100}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
  if (SOCIAL.test(host)) return null;
  return { domain: host, website: `https://${host}` };
}

// A domain registered in the last 60 days sets a staff review flag. Unknown age (lookup failed) sets nothing.
async function flagNewDomain(posting, { check, alert } = {}) {
  if (!posting || !posting.companyDomain || posting.reviewFlag) return false;
  if (!check && !process.env.WHOIS_API_KEY) return false;   // no lookup key set: nothing to check
  const run = check || require('../utils/domainAgeCheck').checkDomainAge;
  const r = await run(posting.companyDomain);
  if (!r || r.reason !== 'too_new') return false;
  posting.reviewFlag = 'new_company_domain';
  posting.reviewClearedAt = null;
  await posting.save();
  const tell = alert || require('./emailService').sendStaffAlertEmail;
  try {
    await tell({ subject: 'New company website on a posting', headline: 'The company website was registered very recently',
      paragraphs: [`Posting ${posting._id} (${posting.title} at ${posting.hiringCompany}) lists ${posting.companyDomain}, registered ${r.ageInDays} days ago. It is still live. Check it looks like a real company.`] });
  } catch (e) { console.error('Staff alert failed:', e.message); }
  return true;
}

module.exports = { normalizeSite, flagNewDomain };
