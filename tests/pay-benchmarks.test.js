const assert = require('assert');
const pb = require('../src/content/payBenchmarks');
const jt = require('../src/content/jobTitles');

// every mapped title exists in the catalog
for (const id of Object.keys(pb.TITLE_SOC)) assert(jt.byId(id), 'unknown title ' + id);

const b = pb.bandFor('devops-engineer', 'Mid-level');
assert.strictEqual(b.soc, '15-1252');
assert.strictEqual(b.low, 132000);
assert.strictEqual(b.high, 168000);
assert.strictEqual(pb.bandFor('help-desk-technician', 'Entry level').low, 38000);
assert.strictEqual(pb.bandFor('help-desk-technician', 'Lead / Principal').high, null);
assert.strictEqual(pb.bandFor('scrum-master', 'Mid-level'), null);
assert.strictEqual(pb.bandFor('devops-engineer', 'Nope'), null);

assert.strictEqual(pb.positionOf(b, 90000, 100000), 'below');
assert.strictEqual(pb.positionOf(b, 130000, 160000), 'below');
assert.strictEqual(pb.positionOf(b, 140000, 165000), 'within');
assert.strictEqual(pb.positionOf(b, 200000, 240000), 'above');
assert.strictEqual(pb.positionOf(null, 1, 2), null);

// bands rise with level for every mapped title
for (const id of Object.keys(pb.TITLE_SOC)) {
  let prev = 0;
  for (const l of pb.LEVELS) { const x = pb.bandFor(id, l); assert(x.low >= prev, id + ' ' + l); prev = x.low; }
}
console.log('pay-benchmarks: ok');
