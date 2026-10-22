// Turns a posting's typed address (or state list) into what the apply gate and the public pages need:
//   areaRule     what services/applyGate.js checks against a candidate's Work Areas (see utils/geo.js)
//   areaLabel    words for the gate's "outside your area" message
//   displayCity/State   all candidates ever see of the location (never the street address)
// The address is looked up ONCE when the posting is saved; the exact point is private.

const axios = require('axios');
const { STATE_CODES } = require('../utils/geo');

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'PreCheckd/1.0 (support@precheckd.com)';
const STATE_NAME_TO_CODE = STATE_CODES;

// ---- pure parsers (tested with canned responses) -------------------------------------------------

function parseCensus(json) {
  const m = json && json.result && json.result.addressMatches && json.result.addressMatches[0];
  if (!m || !m.coordinates) return null;
  const c = m.addressComponents || {};
  return {
    lng: Number(m.coordinates.x), lat: Number(m.coordinates.y),
    city: titleCase(c.city || ''), state: String(c.state || '').toUpperCase(),
  };
}

function parseNominatim(list) {
  const r = Array.isArray(list) && list[0];
  if (!r) return null;
  const a = r.address || {};
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
  const state = STATE_NAME_TO_CODE[a.state] || '';
  return { lng: Number(r.lon), lat: Number(r.lat), city: titleCase(city), state };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function inUnitedStates(g) {
  return g && Number.isFinite(g.lng) && Number.isFinite(g.lat) && g.lat > 17 && g.lat < 72 && g.lng > -180 && g.lng < -64;
}

function joinStates(codes) {
  if (codes.length <= 1) return codes[0] || '';
  if (codes.length === 2) return `${codes[0]} and ${codes[1]}`;
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
}

// ---- lookup ------------------------------------------------------------------------------------

async function geocodeAddress(address, http = axios) {
  const q = String(address || '').trim();
  if (!q) return null;
  try {
    const res = await http.get(CENSUS_URL, {
      params: { address: q, benchmark: 'Public_AR_Current', format: 'json' }, timeout: 8000, headers: { 'User-Agent': USER_AGENT },
    });
    const g = parseCensus(res.data);
    if (inUnitedStates(g)) return g;
  } catch (error) {
    console.error('Census geocoder failed, trying the fallback:', error.message);
  }
  try {
    const res = await http.get(NOMINATIM_URL, {
      params: { format: 'jsonv2', addressdetails: 1, limit: 1, countrycodes: 'us', q }, timeout: 8000, headers: { 'User-Agent': USER_AGENT },
    });
    const g = parseNominatim(res.data);
    if (inUnitedStates(g)) return g;
  } catch (error) {
    console.error('Fallback geocoder failed:', error.message);
  }
  return null;
}

// value: the output of postingValidation.validatePosting. geocode: injectable for tests.
// Returns { areaRule, areaLabel, displayCity, displayState } or throws an Error with code 'geocode_failed'.
async function buildLocation(value, geocode = geocodeAddress) {
  const none = { areaRule: null, areaLabel: '', displayCity: '', displayState: '' };
  if (value.arrangement === 'remote') return none;

  if (value.arrangement === 'remote_in_area' && value.areaReason === 'states') {
    return { areaRule: { states: value.states }, areaLabel: joinStates(value.states), displayCity: '', displayState: '' };
  }

  const g = await geocode(value.address);
  if (!g) {
    const e = new Error('We could not find that address. Check the street, city and state, and try again.');
    e.code = 'geocode_failed';
    throw e;
  }
  const place = [g.city, g.state].filter(Boolean).join(', ');
  if (value.arrangement === 'remote_in_area') {
    return { areaRule: { point: [g.lng, g.lat], radiusMiles: value.radiusMiles }, areaLabel: `within ${value.radiusMiles} miles of ${place}`, displayCity: g.city, displayState: g.state };
  }
  return { areaRule: { point: [g.lng, g.lat] }, areaLabel: place, displayCity: g.city, displayState: g.state };
}

module.exports = { geocodeAddress, buildLocation, parseCensus, parseNominatim, joinStates };
