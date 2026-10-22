// Run: node tests/text-scan.test.js
const assert = require('assert');
const { scanText, scanFields } = require('../src/utils/textScan');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
const codes = (s) => scanText(s).map((i) => i.code);

t('clean text passes', () => {
  assert.deepStrictEqual(codes('You will build and run Linux servers, work with a small team, and help us ship on time.'), []);
  assert.deepStrictEqual(codes(''), []);
  assert.deepStrictEqual(codes(null), []);
});
t('skills with dots are fine: .NET, ASP.NET, Node.js, Vue.js, Next.js', () => {
  assert.deepStrictEqual(codes('Build services in .NET and ASP.NET Core, plus Node.js, Vue.js and Next.js front ends.'), []);
});
t('pay and ordinary numbers are fine', () => {
  assert.deepStrictEqual(codes('The pay is $100,000-$120,000 and the team has 12 people across 3 offices. Contract lasts 2 years.'), []);
});
t('email addresses, including spelled-out ones', () => {
  assert.ok(codes('Send your resume to jobs@acme.com').includes('email'));
  assert.ok(codes('write to jobs [at] acme [dot] com').includes('email'));
});
t('phone numbers in the usual formats', () => {
  for (const p of ['555-123-4567', '(555) 123-4567', '555.123.4567', '+1 555 123 4567', '5551234567']) {
    assert.ok(codes('Call ' + p + ' today').includes('phone'), p);
  }
});
t('links', () => {
  assert.ok(codes('Apply at https://acme.com/jobs').includes('link'));
  assert.ok(codes('See www.acme.com').includes('link'));
  assert.ok(codes('Visit acme.io for more').includes('link'));
});
t('contact-me-elsewhere wording', () => {
  assert.ok(codes('Message me on WhatsApp').includes('off_platform'));
  assert.ok(codes('ping me on Telegram').includes('off_platform'));
  assert.ok(codes('DM me for details').includes('off_platform'));
});
t('years of experience in several forms', () => {
  for (const s of ['5+ years of experience required', '3-5 years experience with Linux', 'Minimum five years of professional experience', '10 yrs hands-on in the field', 'At least 7 years working in security']) {
    assert.ok(codes(s).includes('years_of_experience'), s);
  }
});
t('years without experience wording are not flagged', () => {
  assert.deepStrictEqual(codes('Our company has served customers for 20 years.'), []);
});
t('citizens only wording', () => {
  for (const s of ['US citizens only', 'Must be a U.S. citizen', 'American citizens only', 'Citizenship required']) {
    assert.ok(codes(s).includes('citizens_only'), s);
  }
  assert.deepStrictEqual(codes('Must be authorized to work in the US.'), []);
});
t('age, gender and nationality signals', () => {
  for (const s of ['young and energetic team', 'digital native preferred', 'recent graduate welcome', 'native English speaker', 'he/she will report to the director', 'he or she will lead']) {
    assert.ok(codes(s).includes('age_gender_nationality'), s);
  }
});
t('several problems at once are all reported once each', () => {
  const found = codes('Email a@b.com or call 555-123-4567. 5+ years of experience. Young team.');
  for (const c of ['email', 'phone', 'years_of_experience', 'age_gender_nationality']) assert.ok(found.includes(c), c);
  assert.strictEqual(new Set(found).size, found.length);
});
t('scanFields groups problems by field and accepts lists of lines', () => {
  const out = scanFields({ summary: 'Clean text.', responsibilities: ['Run servers', 'Call 555-123-4567'], growth: 'young team' });
  assert.deepStrictEqual(Object.keys(out).sort(), ['growth', 'responsibilities']);
  assert.strictEqual(out.responsibilities[0].code, 'phone');
});
console.log(`\n${n} tests passed`);
