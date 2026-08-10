import {
  DEFAULT_ACCEPT_RADIUS_KM,
  distanceToCircleKm,
  nearestPointOnShape,
  pointInMultiPolygon,
  scoreForDistance,
  type LatLng,
  type MultiPolygon,
} from './scoring';

/**
 * What a round is scored against.
 *
 * This union is not an implementation detail — it is the wire contract, and
 * this is its ONLY declaration: src/lib/api-types.ts re-exports it rather
 * than restating it, so the client's type and the server's type cannot drift.
 * It mirrors the XOR that migrations/001_initial.sql enforces on the
 * `location` table (exactly one of `geoid` / `radius_km`, on all 1088 rows)
 * and it is what /api/guess returns as `target`, so the client can draw the
 * very geometry the server scored against.
 *
 * SHAPE carries the polygon inline rather than a geoid on purpose: the
 * browser must never learn a stable key it could accumulate into a
 * geoid -> answer dictionary, and shipping the geometry per-guess costs at
 * most ~8.6 KB (Utuado, the largest of the 1063 referenced shapes) against
 * the 1.55 MB shapes-pr.json fetch it replaces.
 */
export type GuessTarget =
  | { type: 'SHAPE'; geometry: MultiPolygon }
  | { type: 'CIRCLE'; radiusKm: number };

/** The scoring half of a round result — everything derivable from geometry alone. */
export interface TargetVerdict {
  distanceKm: number;
  points: number;
  /** True when the guess landed inside the polygon, or inside the acceptance circle. */
  inside: boolean;
}

/**
 * Score a guess against a target. This is the single definition of what a
 * round is worth — the browser calls it through evaluateGuess() in game.ts,
 * and api/guess.ts calls it directly on every production request.
 *
 * It lives here, not in game.ts, for one reason: game.ts imports LOCATIONS as
 * a *value*, so importing it from api/ would pull all 1088 coordinates into
 * the serverless bundle, and it touches window.localStorage, which does not
 * exist in Node. This module has neither problem — it imports only pure math
 * from ./scoring — so the server and the client compute identical results
 * from identical code rather than from two implementations that agree today.
 *
 * `center` is only consulted by the CIRCLE branch. A shape is scored purely
 * from its own boundary, so a mismatch between a location's stored point and
 * its polygon can never affect a shaped round.
 */
export function evaluateTarget(
  guess: LatLng,
  center: LatLng,
  target: GuessTarget,
): TargetVerdict {
  if (target.type === 'SHAPE') {
    const inside = pointInMultiPolygon(guess, target.geometry);
    // Inside is a flat 0 rather than "distance to the nearest edge from the
    // inside": every point within the boundary is equally correct, and the
    // reveal draws no line at all. It also means one ray-cast and no
    // nearest-point walk on the common case, instead of the two polygon
    // traversals a naive distance-then-inside pairing costs.
    const distanceKm = inside ? 0 : nearestPointOnShape(guess, target.geometry).distanceKm;
    return { distanceKm, points: scoreForDistance(distanceKm), inside };
  }

  // distanceToCircleKm already clamps at 0, so `=== 0` is exactly "within the
  // acceptance radius" — the circle's edge plays the same role a polygon's
  // boundary does, which is what makes point locations feel like shaped ones.
  const distanceKm = distanceToCircleKm(guess, center, target.radiusKm);
  return { distanceKm, points: scoreForDistance(distanceKm), inside: distanceKm === 0 };
}

/**
 * Build a GuessTarget from the two nullable fields a location row carries.
 * Both callers pass exactly this pair: game.ts from a GameLocation plus a
 * loaded shape, api/guess.ts from the joined `location` / `shape` row.
 *
 * A shape always wins when present, because a real boundary is a strictly
 * better answer than a circle around an internal point. The
 * DEFAULT_ACCEPT_RADIUS_KM fallback is unreachable with today's data (the
 * database CHECK guarantees every row has one or the other) and is kept
 * anyway so a malformed row degrades to a tight 50 m point instead of
 * throwing inside a request handler.
 */
export function targetForShapeOrRadius(
  shape: MultiPolygon | null,
  radiusKm: number | null | undefined,
): GuessTarget {
  if (shape) return { type: 'SHAPE', geometry: shape };
  return { type: 'CIRCLE', radiusKm: radiusKm ?? DEFAULT_ACCEPT_RADIUS_KM };
}
