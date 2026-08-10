import type { Category, Difficulty, Subtype } from '../data/types';

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
