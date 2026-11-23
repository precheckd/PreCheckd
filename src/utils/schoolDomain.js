// A school's web domain from whatever was typed or downloaded as its website.
const domainOf = (website) => String(website || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
module.exports = { domainOf };
