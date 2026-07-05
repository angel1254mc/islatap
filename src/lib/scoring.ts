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
