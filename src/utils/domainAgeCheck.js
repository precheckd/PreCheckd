const axios = require('axios');

const MINIMUM_DOMAIN_AGE_DAYS = 60;
const WHOIS_TIMEOUT_MS = 5000; // don't let a slow WHOIS lookup hang signup

async function checkDomainAge(domain) {
  try {
    const response = await axios.get('https://www.whoisxmlapi.com/whoisserver/WhoisService', {
      params: {
        apiKey: process.env.WHOIS_API_KEY,
        domainName: domain,
        outputFormat: 'JSON',
      },
      timeout: WHOIS_TIMEOUT_MS,
    });

    const record = response.data?.WhoisRecord;
    const createdDateStr = record?.createdDate || record?.registryData?.createdDate;

    if (!createdDateStr) {
      console.warn(`WHOIS lookup for ${domain} returned no creation date — leaving as pending`);
      return { verified: false, reason: 'no_creation_date' };
    }

    const createdDate = new Date(createdDateStr);
    const ageInDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

    if (ageInDays >= MINIMUM_DOMAIN_AGE_DAYS) {
      return { verified: true, ageInDays, createdDate };
    } else {
      console.log(`Domain ${domain} is only ${ageInDays} days old — leaving as pending`);
      return { verified: false, reason: 'too_new', ageInDays };
    }
  } catch (error) {
    console.error(`WHOIS lookup failed for ${domain}:`, error.message);
    return { verified: false, reason: 'lookup_failed' };
  }
}

module.exports = { checkDomainAge, MINIMUM_DOMAIN_AGE_DAYS };