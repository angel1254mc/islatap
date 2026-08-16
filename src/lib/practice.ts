import type { GameLocation } from '../data/types';
import type { PlayedRound, PromptView } from './round-state';
import type { LatLng } from './scoring';
import { getShape, startShapeLoad } from './shapes';

/**
 * Practice is the original game: five random places drawn on the client and
 * scored on the client, with no server, no date and no score kept.
 *
 * It is deliberately NOT routed through /api/guess. That endpoint is keyed by
 * an opaque per-day roundId minted when a daily puzzle is generated; giving a
 * practice round one would mean writing a row, and the guess endpoint's whole
 * safety property is that it is a pure function with zero writes.
 *
 * KNOWN, ACCEPTED TRADE-OFF: because practice scores locally it needs the
 * full 1088-row coordinate table, and that table is therefore reachable from
 * the browser. A determined player can look today's daily prompt up in it —
 * display names are globally unique by construction. Moving the data
 * server-side does not by itself close that hole; only removing the
 * client-side pool would, and that would mean deleting practice. What the
 * dynamic imports below DO buy is that the 216 KB table is no longer in the
 * first-load bundle: a player who only ever plays the daily puzzle never
 * downloads it.
 */
export interface PracticeGame {
  locations: GameLocation[];
  prompts: PromptView[];
}

export function promptFromLocation(location: GameLocation): PromptView {
  return {
    // Prefixed so a practice key can never be mistaken for a daily roundId
    // in a log or a stored result.
    key: `practice-${location.id}`,
    name: location.name,
    municipio: location.municipio,
    category: location.category,
    subtype: location.subtype,
    difficulty: location.difficulty,
  };
}

export async function loadPracticeGame(): Promise<PracticeGame> {
  // Dynamic, not static: these two modules between them pull curated.ts and
  // the 193 KB tiger.generated.ts, i.e. every lat/lng in the game. Vite splits
  // them into their own chunk, so they are fetched the first time somebody
  // presses Practice and never on a daily-only visit.
  //
  // The split only materialises once NOTHING in the entry graph reaches these
  // modules statically: Rollup keeps a module in the entry chunk if the entry
  // imports it statically, however many dynamic importers it also has. Task 12
  // removes App.tsx's last static edge into game.ts, and that is the step that
  // actually produces a second chunk.
  const [{ LOCATIONS }, { pickGameRounds }] = await Promise.all([
    import('../data/locations'),
    import('./game'),
  ]);

  // Practice scores locally, so it is the only thing that still needs the
  // 1.55 MB boundary file. Started here rather than at app mount so the daily
  // path never pays for it. startShapeLoad() memoises and never rejects.
  await startShapeLoad();

  const locations = pickGameRounds(LOCATIONS);
  return { locations, prompts: locations.map(promptFromLocation) };
}

export async function scorePracticeGuess(
  location: GameLocation,
  guess: LatLng,
): Promise<PlayedRound> {
  // Already resolved and cached after loadPracticeGame(), so this settles in a
  // microtask. Awaiting anyway keeps game.ts out of the static import graph.
  const { evaluateGuess } = await import('./game');
  // undefined when the location has no geoid, or when shapes-pr.json failed
  // to load — evaluateGuess falls back to the acceptance circle either way.
  const shape = getShape(location.geoid) ?? null;
  const outcome = evaluateGuess(location, guess, shape);

  const round: PlayedRound = {
    key: `practice-${location.id}`,
    name: location.name,
    municipio: location.municipio,
    subtype: location.subtype,
    guess,
    answer: {
      lat: location.lat,
      lng: location.lng,
      name: location.name,
      municipio: location.municipio,
    },
    distanceKm: outcome.distanceKm,
    points: outcome.points,
    inside: outcome.inside,
    shape: outcome.shape,
    acceptRadiusKm: outcome.acceptRadiusKm,
  };
  return round;
}
