// Run: node tests/geo.test.js
const assert = require('assert');
const { areaMatch, stateGeometry, US_STATES, distPointToSegmentMiles } = require('../src/utils/geo');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

const box = (w, s, e, nn) => ({ type: 'MultiPolygon', coordinates: [[[[w, s], [e, s], [e, nn], [w, nn], [w, s]]]] });

// A rough box around Manhattan and a bit of the Hudson's New Jersey side.
const manhattan = box(-74.05, 40.70, -73.93, 40.80);
// A box over eastern Long Island only (Suffolk County area).
const suffolk = box(-73.2, 40.8, -72.0, 41.0);

t('point inside Work Area', () => assert.strictEqual(areaMatch(manhattan, { point: [-73.99, 40.75] }), true));
t('point outside Work Area', () => assert.strictEqual(areaMatch(manhattan, { point: [-71.06, 42.36] }), false)); // Boston
t('no Work Areas drawn gives null', () => {
  assert.strictEqual(areaMatch(null, { point: [-73.99, 40.75] }), null);
  assert.strictEqual(areaMatch({ type: 'MultiPolygon', coordinates: [] }, { point: [0, 0] }), null);
});
t('unreadable rule gives null', () => assert.strictEqual(areaMatch(manhattan, {}), null));

t('radius touching the area counts (Newark, 20 mi, Manhattan box)', () =>
  assert.strictEqual(areaMatch(manhattan, { point: [-74.17, 40.735], radiusMiles: 20 }), true));
t('radius that stops short does not count (Newark, 3 mi from a box about 7 mi away)', () =>
  assert.strictEqual(areaMatch(manhattan, { point: [-74.30, 40.735], radiusMiles: 3 }), false));
t('radius centered inside the area counts even when tiny', () =>
  assert.strictEqual(areaMatch(manhattan, { point: [-73.99, 40.75], radiusMiles: 1 }), true));
t('Boston 50 mi does not reach Manhattan', () =>
  assert.strictEqual(areaMatch(manhattan, { point: [-71.06, 42.36], radiusMiles: 50 }), false));
t('a Work Area entirely inside a big circle counts', () =>
  assert.strictEqual(areaMatch(manhattan, { point: [-73.5, 40.9], radiusMiles: 60 }), true));

t('state list: Manhattan area touches NY', () => assert.strictEqual(areaMatch(manhattan, { states: ['NY'] }), true));
t('state list: Manhattan area touches NJ (Hudson west bank is in the box)', () =>
  assert.strictEqual(areaMatch(manhattan, { states: ['NJ'] }), true));
t('state list: any one state is enough', () => assert.strictEqual(areaMatch(manhattan, { states: ['TX', 'CT', 'NY'] }), true));
t('state list: Manhattan area does not touch TX or CA', () => assert.strictEqual(areaMatch(manhattan, { states: ['TX', 'CA'] }), false));
t('state list: Suffolk area touches NY', () => {
  assert.strictEqual(areaMatch(suffolk, { states: ['NY'] }), true);
});
t('state list: a Work Area wholly inside a state counts', () =>
  assert.strictEqual(areaMatch(box(-99.0, 31.0, -98.5, 31.5), { states: ['TX'] }), true));
t('state list: lowercase and unknown codes are tolerated', () => {
  assert.strictEqual(areaMatch(manhattan, { states: ['ny'] }), true);
  assert.strictEqual(areaMatch(manhattan, { states: ['ZZ'] }), false);
});
t('a candidate with several shapes matches if any one does', () => {
  const two = { type: 'MultiPolygon', coordinates: [...manhattan.coordinates, ...box(-99.0, 31.0, -98.5, 31.5).coordinates] };
  assert.strictEqual(areaMatch(two, { states: ['TX'] }), true);
});

t('all 51 states and DC have boundaries', () => {
  assert.strictEqual(US_STATES.length, 51);
  for (const s of US_STATES) assert.ok(stateGeometry(s.code), s.code + ' missing');
});
t('distance helper: 1 degree of latitude is about 69 miles', () => {
  const d = distPointToSegmentMiles([0, 0], [-1, 1], [1, 1]);
  assert.ok(Math.abs(d - 69) < 0.5, String(d));
});

console.log(`\n${n} tests passed`);
