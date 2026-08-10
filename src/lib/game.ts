import { LOCATIONS, type Category, type GameLocation } from '../data/locations';
import { MAX_ROUND_POINTS, type LatLng, type MultiPolygon } from './scoring';
import { evaluateTarget, targetForShapeOrRadius } from './target';

export const ROUNDS_PER_GAME = 5;
export const MAX_GAME_POINTS = ROUNDS_PER_GAME * MAX_ROUND_POINTS;

export interface RoundOutcome {
  location: GameLocation;
  guess: LatLng;
  distanceKm: number;
  points: number;
  /** True when the guess landed inside the target's boundary shape. */
  inside: boolean;
  /**
   * The shape used for scoring this round, captured at guess time. Reused for
   * the reveal render so the drawn polygon can never disagree with the score
   * (getShape() could otherwise return something different by then, e.g. once
   * shapes-pr.json finishes loading between tap and reveal).
   */
  shape: MultiPolygon | null;
  /**
   * Acceptance radius used when there was no shape (drawn as a circle on the
   * reveal), or null when the round was scored against a shape.
   */
  acceptRadiusKm: number | null;
}

/**
 * Score a guess and package it as a RoundOutcome for the UI.
 *
 * The scoring rules themselves live in ./target (evaluateTarget), NOT here,
 * because api/guess.ts has to apply exactly the same rules and cannot import
 * this file: line 1 pulls LOCATIONS in as a value, which would bundle all
 * 1088 coordinates into the serverless function. Keeping the geometry rules in
 * a dependency-free module is what stops the server's score and the client's
 * reveal from drifting apart.
 *
 * What stays here is the shape of RoundOutcome: the location echo and the
 * (shape, acceptRadiusKm) pair the map needs to draw the reveal.
 */
export function evaluateGuess(
  location: GameLocation,
  guess: LatLng,
  shape: MultiPolygon | null,
): RoundOutcome {
  const target = targetForShapeOrRadius(shape, location.radiusKm);
  // GameLocation is structurally a LatLng, so it doubles as the circle center.
  const verdict = evaluateTarget(guess, location, target);

  return {
    location,
    guess,
    distanceKm: verdict.distanceKm,
    points: verdict.points,
    inside: verdict.inside,
    shape,
    // Null for a shaped round: the reveal draws the polygon, not a circle.
    // Otherwise the radius actually used, including the 50 m default, so the
    // drawn circle is always the circle that was scored.
    acceptRadiusKm: target.type === 'CIRCLE' ? target.radiusKm : null,
  };
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Pick 5 distinct, category-varied locations: one guaranteed from each
 * category (municipio, landmark, barrio), then the remaining slots filled by
 * drawing a category first and a location second, and finally shuffled so the
 * guaranteed picks don't always lead.
 *
 * Filling per-category rather than from a flat pool matters: barrios outnumber
 * everything else roughly 11:1 since the TIGER import, so a flat draw would make
 * nearly every unguaranteed round an obscure rural barrio.
 */
export function pickGameRounds(pool: readonly GameLocation[] = LOCATIONS): GameLocation[] {
  const byCategory = new Map<Category, GameLocation[]>();
  for (const location of shuffle(pool)) {
    const bucket = byCategory.get(location.category) ?? [];
    bucket.push(location);
    byCategory.set(location.category, bucket);
  }

  const picked: GameLocation[] = [];
  for (const bucket of byCategory.values()) {
    const location = bucket.shift();
    if (location && picked.length < ROUNDS_PER_GAME) {
      picked.push(location);
    }
  }

  while (picked.length < ROUNDS_PER_GAME) {
    const available = [...byCategory.values()].filter((bucket) => bucket.length > 0);
    if (available.length === 0) break;
    const bucket = available[Math.floor(Math.random() * available.length)];
    picked.push(bucket.shift() as GameLocation);
  }

  return shuffle(picked);
}
