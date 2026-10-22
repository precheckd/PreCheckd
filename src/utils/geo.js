// Geometry for the apply gate's area check: does a candidate's drawn Work Areas (a GeoJSON
// MultiPolygon, [polygon][ring][[lng, lat]]) cover a job's location rule?
//
// Pure JavaScript, no database. Three job rules:
//   - a point (an on-site or hybrid address)          -> the point is inside a Work Area
//   - a radius around an address (Remote in Area)     -> the circle touches a Work Area
//   - a list of states (Remote in Area)               -> a state touches a Work Area
// "Touches" means any overlap at all. A candidate who works Manhattan is not asked to also
// cover all of New York State; one overlap with the job's area is enough.

const topojson = require('topojson-client');
const topology = require('../data/us-states-10m.topo.json');

const STATE_CODES = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
const US_STATES = Object.entries(STATE_CODES).map(([name, code]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const MILES_PER_DEG_LAT = 69.0;

// ---- low-level helpers -------------------------------------------------------------------------

function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// polygon = [outerRing, ...holes]
function pointInPolygon(pt, polygon) {
  if (!polygon || !polygon.length || !pointInRing(pt, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) if (pointInRing(pt, polygon[h])) return false;
  return true;
}

function pointInMulti(pt, multi) {
  return polygonsOf(multi).some((poly) => pointInPolygon(pt, poly));
}

function polygonsOf(multi) {
  return multi && Array.isArray(multi.coordinates) ? multi.coordinates : [];
}

function ccw(a, b, c) { return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]); }
function segmentsCross(a, b, c, d) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

// Distance in miles from point p to segment a-b, on a flat local projection around p. Accurate
// to well under a percent at the sizes a job radius or a Work Area covers.
function distPointToSegmentMiles(p, a, b) {
  const kx = MILES_PER_DEG_LAT * Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * MILES_PER_DEG_LAT;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * MILES_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

function bboxOfPolygon(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
function bboxesOverlap(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }

// ---- the three area tests ----------------------------------------------------------------------

function circleTouchesMulti(center, radiusMiles, multi) {
  for (const polygon of polygonsOf(multi)) {
    if (pointInPolygon(center, polygon)) return true;
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        if (distPointToSegmentMiles(center, ring[i], ring[i + 1]) <= radiusMiles) return true;
      }
    }
  }
  return false;
}

function polygonsTouch(p, q) {
  if (!bboxesOverlap(bboxOfPolygon(p), bboxOfPolygon(q))) return false;
  if (p[0].some((pt) => pointInPolygon(pt, q))) return true;
  if (q[0].some((pt) => pointInPolygon(pt, p))) return true;
  const a = p[0], b = q[0];
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return false;
}

function multisTouch(m1, m2) {
  for (const p of polygonsOf(m1)) for (const q of polygonsOf(m2)) if (polygonsTouch(p, q)) return true;
  return false;
}

// ---- states ------------------------------------------------------------------------------------

let stateCache = null;
function loadStates() {
  if (stateCache) return stateCache;
  stateCache = new Map();
  const fc = topojson.feature(topology, topology.objects.states);
  for (const f of fc.features) {
    const code = STATE_CODES[f.properties.name];
    if (!code) continue; // territories are not in the US-only list
    const g = f.geometry;
    stateCache.set(code, { type: 'MultiPolygon', coordinates: g.type === 'Polygon' ? [g.coordinates] : g.coordinates });
  }
  return stateCache;
}

function stateGeometry(code) { return loadStates().get(String(code).toUpperCase()) || null; }

// ---- the one entry point the apply gate uses ---------------------------------------------------

function validWorkAreas(workAreas) {
  return Boolean(workAreas && workAreas.type === 'MultiPolygon' && Array.isArray(workAreas.coordinates) && workAreas.coordinates.length);
}

// rule: { point: [lng, lat] }                      an exact location (on-site, hybrid)
//       { point: [lng, lat], radiusMiles: n }      within n miles of a location (Remote in Area)
//       { states: ['NY', 'NJ'] }                   any of these states (Remote in Area)
// Returns true | false, or null when the candidate has drawn no Work Areas (the gate then asks
// them to add some) or the rule cannot be read.
function areaMatch(workAreas, rule) {
  if (!validWorkAreas(workAreas)) return null;
  if (!rule) return null;
  if (Array.isArray(rule.states) && rule.states.length) {
    return rule.states.some((code) => {
      const geom = stateGeometry(code);
      return geom ? multisTouch(workAreas, geom) : false;
    });
  }
  if (Array.isArray(rule.point) && rule.point.length === 2) {
    if (rule.radiusMiles > 0) return circleTouchesMulti(rule.point, rule.radiusMiles, workAreas);
    return pointInMulti(rule.point, workAreas);
  }
  return null;
}

module.exports = {
  US_STATES, STATE_CODES, areaMatch, stateGeometry,
  pointInMulti, circleTouchesMulti, multisTouch, distPointToSegmentMiles,
};
