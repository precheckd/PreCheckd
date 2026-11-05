// Run: node tests/ask-page.test.js
// The /ask page: question rows render, videos load lazily, and the cost answer matches the chat's facts.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { getAnswers } = require('../src/content/askAnswers');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
const render = (billingLive) => ejs.render(
  fs.readFileSync(path.join(__dirname, '..', 'views', 'ask.ejs'), 'utf8'),
  { answers: getAnswers({ billingLive }), pageTitle: 'x' }, { filename: path.join(__dirname, '..', 'views', 'ask.ejs') }
);
const knowledge = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'chatKnowledge.md'), 'utf8');
const launch = knowledge.split('### LAUNCH')[1].split('\n## ')[0];

t('rows have unique ids, a question and an answer', () => {
  const a = getAnswers();
  assert.strictEqual(new Set(a.map((x) => x.id)).size, a.length);
  a.forEach((x) => { assert.ok(x.q && x.paras.length, x.id); });
});
t('why-paying is first, featured and open; nothing else opens by default', () => {
  const a = getAnswers();
  assert.strictEqual(a[0].id, 'why-paying');
  assert.ok(a[0].featured && a[0].open);
  assert.strictEqual(a.filter((x) => x.open).length, 1);
});
t('the page renders every question', () => {
  const html = render(false);
  getAnswers().forEach((x) => assert.ok(html.includes('id="' + x.id + '"'), x.id));
  assert.strictEqual((html.match(/<details class="qa/g) || []).length, getAnswers().length);
});
t('videos are not loaded until a row opens (data-src only, no source tag in the markup)', () => {
  const html = render(false);
  assert.ok(html.includes('data-src="https://precheckd-marketing.s3.us-east-2.amazonaws.com/videos/ask-skill-tests.mp4"'));
  assert.ok(!/<video[^>]*\ssrc=/.test(html));
  assert.ok(!/<source[^>]*s3/.test(html));
});
t('rows without a video are text only', () => {
  const html = render(false);
  const cost = html.split('id="cost"')[1].split('</details>')[0];
  assert.ok(!cost.includes('<video'));
  assert.ok(!cost.includes('has-video'));
});
t('the why-paying answer has no prices', () => {
  assert.ok(!/\$\d/.test(getAnswers()[0].paras.join(' ')));
});
t('before billing, the cost answer shows no prices', () => {
  const cost = getAnswers({ billingLive: false }).find((x) => x.id === 'cost').paras.join(' ');
  assert.ok(!/\$\d/.test(cost));
  assert.ok(cost.includes('not live yet'));
});
t('at launch, every price in the cost answer is in the chat assistant\'s launch block', () => {
  const cost = getAnswers({ billingLive: true }).find((x) => x.id === 'cost').paras.join(' ');
  const prices = cost.match(/\$\d[\d,]*/g);
  assert.ok(prices.length >= 8);
  prices.forEach((p) => assert.ok(launch.includes(p), p + ' missing from chatKnowledge.md LAUNCH block'));
});
t('answer text is escaped, not injected', () => {
  const html = render(false);
  assert.ok(html.includes("I&#39;m a recruiter") || html.includes("I'm a recruiter"));
});
t('the chat sits under all the questions, above the final signup box', () => {
  const html = render(false);
  const lastRow = html.lastIndexOf('<details class="qa');
  const chat = html.indexOf('id="chat"');
  const final = html.indexOf('class="ask-final"');
  assert.ok(lastRow < chat && chat < final);
});
t('the pop-out widget renders and is left off /ask and staff pages', () => {
  const widget = ejs.render(fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'chat-widget.ejs'), 'utf8'), {});
  assert.ok(widget.includes('id="pcLauncher"') && widget.includes('/js/chat-assistant.js'));
  const layout = fs.readFileSync(path.join(__dirname, '..', 'views', 'layouts', 'main.ejs'), 'utf8');
  assert.ok(layout.includes("partials/chat-widget"));
  assert.ok(layout.includes("_cp === '/ask'") && layout.includes("indexOf('/internal')"));
});
console.log(n + ' passed');
