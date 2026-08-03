export interface LatLng {
  lat: number;
  lng: number;
}

/** Maximum points a single round can award. */
export const MAX_ROUND_POINTS = 5000;

/** Exponential decay constant, in kilometers, for the scoring curve. */
export const DISTANCE_DECAY_KM = 10;

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in kilometers. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Acceptance radius for point-only locations (no boundary shape), in km.
 * A guess inside the circle scores full marks; decay starts at its edge,
 * mirroring how shaped locations decay from the polygon boundary.
 */
export const DEFAULT_ACCEPT_RADIUS_KM = 0.05;

/** Points for a guess `distanceKm` away from the target, clamped to [0, MAX_ROUND_POINTS]. */
export function scoreForDistance(distanceKm: number): number {
  const raw = Math.round(MAX_ROUND_POINTS * Math.exp(-distanceKm / DISTANCE_DECAY_KM));
  return Math.min(MAX_ROUND_POINTS, Math.max(0, raw));
}

/** "532 m" under a kilometer, otherwise "12.3 km". */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

// ---------------------------------------------------------------- shapes

/** [lat, lng] pair — matches Leaflet's LatLngTuple ordering. */
export type LatLngTuple = [number, number];
export type Ring = LatLngTuple[];
/** Polygon parts → rings; within a part, ring 0 is the outer ring, the rest are holes. */
export type MultiPolygon = Ring[][];

/**
 * Kilometers per degree of latitude (and of longitude at the equator). Derived
 * from the same Earth radius as haversineKm so the two distance systems agree.
 */
const KM_PER_DEG = (2 * Math.PI * EARTH_RADIUS_KM) / 360;

/** Even-odd ray cast across every ring; holes count out, parts count in. */
export function pointInMultiPolygon(point: LatLng, shape: MultiPolygon): boolean {
  let inside = false;
  for (const part of shape) {
    for (const ring of part) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [latI, lngI] = ring[i];
        const [latJ, lngJ] = ring[j];
        if (
          latI > point.lat !== latJ > point.lat &&
          point.lng < ((lngJ - lngI) * (point.lat - latI)) / (latJ - latI) + lngI
        ) {
          inside = !inside;
        }
      }
    }
  }
  return inside;
}

/**
 * Nearest point on a segment in a local equirectangular plane. Adequate at
 * Puerto Rico scale (< 0.1% error) and, unlike haversine-per-vertex, gives
 * the projected point back for drawing.
 */
function segmentNearest(
  point: LatLng,
  a: LatLngTuple,
  b: LatLngTuple,
): { distanceKm: number; at: LatLng } {
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const ax = a[1] * cosLat;
  const ay = a[0];
  const bx = b[1] * cosLat;
  const by = b[0];
  const px = point.lng * cosLat;
  const py = point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const distanceKm = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * KM_PER_DEG;
  return {
    distanceKm,
    at: { lat: a[0] + t * (b[0] - a[0]), lng: a[1] + t * (b[1] - a[1]) },
  };
}

/** Closest boundary point across all rings (holes included — their edge is a border too). */
export function nearestPointOnShape(
  point: LatLng,
  shape: MultiPolygon,
): { point: LatLng; distanceKm: number } {
  let best: { point: LatLng; distanceKm: number } = { point, distanceKm: Infinity };
  for (const part of shape) {
    for (const ring of part) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const candidate = segmentNearest(point, ring[j], ring[i]);
        if (candidate.distanceKm < best.distanceKm) {
          best = { point: candidate.at, distanceKm: candidate.distanceKm };
        }
      }
    }
  }
  return best;
}

/** 0 inside the shape, otherwise distance to the nearest boundary, in km. */
export function distanceToShapeKm(point: LatLng, shape: MultiPolygon): number {
  if (pointInMultiPolygon(point, shape)) return 0;
  return nearestPointOnShape(point, shape).distanceKm;
}

// Acceptance-circle analogues of the shape helpers above, so callers handling
// the shape-vs-radius split use the same vocabulary for both geometries.

/** 0 inside the acceptance circle, otherwise distance beyond its edge, in km. */
export function distanceToCircleKm(point: LatLng, center: LatLng, radiusKm: number): number {
  return Math.max(0, haversineKm(point, center) - radiusKm);
}

/**
 * Closest point on the circle's edge to `point`, in the local equirectangular
 * plane — used to land the reveal line on the edge rather than the center.
 * Returns the center if `point` sits exactly on it (direction is undefined).
 */
export function nearestPointOnCircle(point: LatLng, center: LatLng, radiusKm: number): LatLng {
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const dx = (point.lng - center.lng) * cosLat;
  const dy = point.lat - center.lat;
  const lengthDeg = Math.hypot(dx, dy);
  if (lengthDeg === 0) return { lat: center.lat, lng: center.lng };
  const t = radiusKm / KM_PER_DEG / lengthDeg;
  return { lat: center.lat + dy * t, lng: center.lng + (point.lng - center.lng) * t };
}
