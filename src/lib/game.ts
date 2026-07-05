import { LOCATIONS, type Category, type GameLocation } from '../data/locations';
import { MAX_ROUND_POINTS, formatDistance, type LatLng } from './scoring';

export const ROUNDS_PER_GAME = 5;
export const MAX_GAME_POINTS = ROUNDS_PER_GAME * MAX_ROUND_POINTS;

export interface RoundOutcome {
  location: GameLocation;
  guess: LatLng;
  distanceKm: number;
  points: number;
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
 * category (municipio, landmark, barrio), the rest drawn from the whole pool,
 * then shuffled so the guaranteed picks don't always lead.
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

  const remaining = shuffle([...byCategory.values()].flat());
  while (picked.length < ROUNDS_PER_GAME) {
    const location = remaining.shift();
    if (!location) break;
    picked.push(location);
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
    return `${badge} ${medalFor(outcome.points)} ${outcome.location.name} — ${formatDistance(outcome.distanceKm)} — ${outcome.points.toLocaleString('en-US')}`;
  });
  return [header, ...lines].join('\n');
}
