import { LOCATIONS, displayName, type Category, type GameLocation } from '../data/locations';
import {
  DEFAULT_ACCEPT_RADIUS_KM,
  MAX_ROUND_POINTS,
  distanceToCircleKm,
  distanceToShapeKm,
  formatDistance,
  pointInMultiPolygon,
  scoreForDistance,
  type LatLng,
  type MultiPolygon,
} from './scoring';

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
 * Score a guess. With a shape: inside = full marks, outside decays from the
 * nearest boundary. Without one: a circle of `location.radiusKm` (default
 * 50 m) around the point acts as the boundary — inside it is full marks, and
 * decay starts at its edge, so point locations mirror shaped ones.
 */
export function evaluateGuess(
  location: GameLocation,
  guess: LatLng,
  shape: MultiPolygon | null,
): RoundOutcome {
  if (shape) {
    const distanceKm = distanceToShapeKm(guess, shape);
    return {
      location,
      guess,
      distanceKm,
      points: scoreForDistance(distanceKm),
      inside: pointInMultiPolygon(guess, shape),
      shape,
      acceptRadiusKm: null,
    };
  }
  const acceptRadiusKm = location.radiusKm ?? DEFAULT_ACCEPT_RADIUS_KM;
  const distanceKm = distanceToCircleKm(guess, location, acceptRadiusKm);
  return {
    location,
    guess,
    distanceKm,
    points: scoreForDistance(distanceKm),
    inside: distanceKm === 0,
    shape: null,
    acceptRadiusKm,
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

const BEST_SCORE_KEY = 'islatap:best-score';

export function loadBestScore(): number | null {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveBestScore(score: number): void {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch {
    // Storage unavailable (private mode, etc.) — best score just won't persist.
  }
}

const ROUND_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'] as const;

function medalFor(points: number): string {
  if (points >= 4500) return '🟩';
  if (points >= 3000) return '🟨';
  if (points >= 1500) return '🟧';
  return '🟥';
}

export function buildShareText(outcomes: readonly RoundOutcome[], total: number): string {
  const header = `IslaTap — ${total.toLocaleString('en-US')} / ${MAX_GAME_POINTS.toLocaleString('en-US')} 🇵🇷`;
  const lines = outcomes.map((outcome, index) => {
    const badge = ROUND_EMOJI[index] ?? `${index + 1}.`;
    const distanceLabel = outcome.inside ? '¡Adentro!' : formatDistance(outcome.distanceKm);
    return `${badge} ${medalFor(outcome.points)} ${displayName(outcome.location)} — ${distanceLabel} — ${outcome.points.toLocaleString('en-US')}`;
  });
  return [header, ...lines].join('\n');
}
