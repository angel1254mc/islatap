import type { Category, Difficulty, Subtype } from '../data/types';
import type { GuessTarget } from './target';

/**
 * Wire contracts for the public endpoints, shared by api/ and the browser.
 *
 * Types only — this module compiles to nothing, so importing it from either
 * side is free and, crucially, importing it from api/ pulls in no location data
 * (src/data/types.ts declares types and one string helper; `import type` erases
 * all of it). Keeping one definition means a field renamed on the server is a
 * compile error in the client rather than an undefined at runtime.
 *
 * This file is the ONLY place the wire shapes are declared. src/lib/api.ts (the
 * browser client) declares none of its own — it imports from here and re-exports
 * under whatever names the UI prefers.
 */

/**
 * One prompt in the daily puzzle.
 *
 * Note what is absent and why: no geoid, no lat/lng, no radiusKm, and no stable
 * location id. `roundId` is an opaque per-day uuid, so a player cannot
 * accumulate an id -> coordinate dictionary across days.
 *
 * `subtype` and `difficulty` are required rather than optional because
 * api/daily.ts always selects them and RoundPrompt renders both as tags. They
 * narrow nothing toward a coordinate — a difficulty band inside a subtype spans
 * the whole island and names no place.
 */
export interface DailyRound {
  roundId: string;
  /** 1-based position in the day's puzzle; also the round number on screen. */
  ordinal: number;
  name: string;
  /** null for every municipio and every landmark — 104 of 1088 rows. */
  municipio: string | null;
  category: Category;
  subtype: Subtype;
  difficulty: Difficulty;
}

export interface DailyPayload {
  /** Calendar date in Puerto Rico, 'YYYY-MM-DD'. The client keys its history on this. */
  gameDate: string;
  rounds: DailyRound[];
}

/**
 * What the round was scored against, and what the map draws on the reveal.
 *
 * Re-exported, not redeclared: src/lib/target.ts owns GuessTarget, because
 * evaluateTarget() is the function that consumes it and both the server and the
 * client score through that one function. A second structurally-identical
 * declaration here would compile forever and drift the first time one side
 * gains a variant.
 *
 * The discriminant is not a judgement call: every one of the 1088 locations has
 * exactly one of geoid or radius_km and never both, enforced by a CHECK
 * constraint. 1063 rows are shapes (Census boundaries); 25 are circles — 21
 * landmarks like El Morro plus Isla Verde, La Perla, Levittown and Piñones,
 * colloquial areas with no Census polygon.
 *
 * `geometry` inside it is the repo's Leaflet-ordered MultiPolygon: Ring[][]
 * whose points are [lat, lng], NOT GeoJSON's [lng, lat]. It is the literal
 * geometry the server scored against, so the polygon the player sees can never
 * disagree with the points they got — the same invariant RoundOutcome.shape used
 * to hold by capturing the shape at guess time.
 *
 * Worst case on the wire is ~8.6 KB (Utuado, geoid 72141); the median is ~1 KB.
 * That is why shapes-pr.json (1.55 MB) can leave the critical path entirely.
 */
export type { GuessTarget } from './target';

/** What the browser sends when a player taps the map. */
export interface GuessRequest {
  roundId: string;
  lat: number;
  lng: number;
}

/** Revealed only after a guess is scored — never in the daily payload. */
export interface GuessAnswer {
  lat: number;
  lng: number;
  name: string;
  municipio: string | null;
}

export interface GuessResponse {
  points: number;
  distanceKm: number;
  /** Inside the boundary shape, or inside the acceptance circle. */
  inside: boolean;
  answer: GuessAnswer;
  target: GuessTarget;
}
