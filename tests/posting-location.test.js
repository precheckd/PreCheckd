// Run: node tests/posting-location.test.js   (no network: lookups are canned)
const assert = require('assert');
const { buildLocation, parseCensus, parseNominatim, joinStates, geocodeAddress } = require('../src/services/postingLocation');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok  ' + name); }

const censusOk = { result: { addressMatches: [{ coordinates: { x: -71.0589, y: 42.3601 }, addressComponents: { city: 'BOSTON', state: 'MA' } }] } };
const nominatimOk = [{ lon: '-73.9857', lat: '40.7484', address: { city: 'New York', state: 'New York' } }];
const boston = async () => ({ lng: -71.0589, lat: 42.3601, city: 'Boston', state: 'MA' });

(async () => {
  await t('parsers', async () => {
    assert.deepStrictEqual(parseCensus(censusOk), { lng: -71.0589, lat: 42.3601, city: 'Boston', state: 'MA' });
    assert.strictEqual(parseCensus({ result: { addressMatches: [] } }), null);
    assert.strictEqual(parseCensus(null), null);
    assert.deepStrictEqual(parseNominatim(nominatimOk), { lng: -73.9857, lat: 40.7484, city: 'New York', state: 'NY' });
    assert.strictEqual(parseNominatim([]), null);
  });
  await t('joinStates', async () => {
    assert.strictEqual(joinStates(['NY']), 'NY');
    assert.strictEqual(joinStates(['NY', 'NJ']), 'NY and NJ');
    assert.strictEqual(joinStates(['NY', 'NJ', 'CT']), 'NY, NJ and CT');
  });
  await t('on-site: exact point stays private, only city and state are displayed', async () => {
    const loc = await buildLocation({ arrangement: 'onsite', address: '1 Main St' }, boston);
    assert.deepStrictEqual(loc.areaRule, { point: [-71.0589, 42.3601] });
    assert.strictEqual(loc.areaLabel, 'Boston, MA');
    assert.strictEqual(loc.displayCity, 'Boston');
    assert.strictEqual(loc.displayState, 'MA');
  });
  await t('remote in area by radius', async () => {
    const loc = await buildLocation({ arrangement: 'remote_in_area', areaReason: 'radius', address: '1 Main St', radiusMiles: 50 }, boston);
    assert.deepStrictEqual(loc.areaRule, { point: [-71.0589, 42.3601], radiusMiles: 50 });
    assert.strictEqual(loc.areaLabel, 'within 50 miles of Boston, MA');
  });
  await t('remote in area by states needs no lookup', async () => {
    const loc = await buildLocation({ arrangement: 'remote_in_area', areaReason: 'states', states: ['NY', 'NJ', 'CT'] }, async () => { throw new Error('should not be called'); });
    assert.deepStrictEqual(loc.areaRule, { states: ['NY', 'NJ', 'CT'] });
    assert.strictEqual(loc.areaLabel, 'NY, NJ and CT');
    assert.strictEqual(loc.displayCity, '');
  });
  await t('remote has no location', async () => {
    const loc = await buildLocation({ arrangement: 'remote' }, async () => { throw new Error('should not be called'); });
    assert.strictEqual(loc.areaRule, null);
  });
  await t('an address that cannot be found is an error the recruiter can fix', async () => {
    await assert.rejects(() => buildLocation({ arrangement: 'onsite', address: 'zzzz' }, async () => null), (e) => e.code === 'geocode_failed');
  });
  await t('geocodeAddress: census first, fallback second, US only, nothing found gives null', async () => {
    const calls = [];
    const http = (responses) => ({ get: async (url) => { calls.push(url); const r = responses.shift(); if (r instanceof Error) throw r; return { data: r }; } });
    assert.strictEqual((await geocodeAddress('1 Main St Boston', http([censusOk]))).city, 'Boston');
    assert.strictEqual(calls.length, 1);
    calls.length = 0;
    assert.strictEqual((await geocodeAddress('x', http([new Error('down'), nominatimOk]))).state, 'NY');
    assert.strictEqual(calls.length, 2);
    // a match outside the United States is rejected
    const paris = [{ lon: '2.35', lat: '48.85', address: { city: 'Paris', state: 'Ile-de-France' } }];
    assert.strictEqual(await geocodeAddress('Paris', http([{ result: { addressMatches: [] } }, paris])), null);
    assert.strictEqual(await geocodeAddress('', http([])), null);
  });
  console.log(`\n${n} tests passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
