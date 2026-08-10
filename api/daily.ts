import type { Category, Difficulty, Subtype } from '../src/data/types.js';
import type { DailyPayload } from '../src/lib/api-types.js';
import { todayInAst } from './_lib/date.js';
import { getSql, type SqlRow } from './_lib/db.js';
import { jsonResponse } from './_lib/http.js';

export const config = { runtime: 'nodejs' };

/**
 * The day's prompts.
 *
 * The column list is a security boundary, not a convenience: location.lat,
 * location.lng, location.geoid, location.radius_km and location.id are all
 * deliberately absent from the SELECT. `l.id` still appears in the JOIN
 * predicate — that is how a round resolves to a place at all — but it never
 * reaches the projection, and the projection is what becomes the response. The
 * only handle the browser gets is puzzle_round.id: a uuid minted per day, so
 * knowing today's round ids tells you nothing about tomorrow's and nothing
 * about which of the 1088 rows they point at.
 */
export const DAILY_ROUNDS_SQL = `
SELECT pr.id::text AS round_id,
       pr.ordinal,
       l.name,
       l.municipio,
       l.category,
       l.subtype,
       l.difficulty
  FROM puzzle_round pr
  JOIN location l ON l.id = pr.location_id
 WHERE pr.game_date = $1::date
 ORDER BY pr.ordinal
`;

/**
 * Build the response field by field. Never spread a database row into a
 * payload: the day someone adds a column to the SELECT for debugging, a spread
 * would ship it to every player without a single test failing.
 */
export function toDailyPayload(gameDate: string, rows: readonly SqlRow[]): DailyPayload {
  return {
    gameDate,
    rounds: rows.map((row) => ({
      roundId: String(row.round_id),
      ordinal: Number(row.ordinal),
      name: String(row.name),
      // A missing municipio is meaningful data (every municipio and landmark
      // has one), so it stays null instead of becoming the string "null".
      municipio: row.municipio === null || row.municipio === undefined ? null : String(row.municipio),
      category: String(row.category) as Category,
      subtype: String(row.subtype) as Subtype,
      difficulty: String(row.difficulty) as Difficulty,
    })),
  };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method-not-allowed' }, 405, { allow: 'GET' });
  }

  // Resolved server-side so every player in the world gets the same puzzle at
  // the same wall-clock moment in San Juan, regardless of their device's zone.
  const gameDate = todayInAst();

  try {
    const rows = await getSql()(DAILY_ROUNDS_SQL, [gameDate]);
    if (rows.length === 0) {
      // The 30-day buffer has a hole — the cron has been failing for a month, or
      // the seed never ran. Say so plainly: an empty rounds array would start a
      // zero-round game in the browser and look like a client bug.
      return jsonResponse({ error: 'no-puzzle' }, 503, { 'retry-after': '300' });
    }
    return jsonResponse(toDailyPayload(gameDate, rows), 200, {
      // The payload is identical for every player and changes only at AST
      // midnight. A minute of edge caching absorbs the morning spike; the worst
      // case at the boundary is one stale minute, and the client keys its
      // history on the gameDate in the body, so a stale payload can never be
      // filed under the wrong day.
      'cache-control': 'public, max-age=60, s-maxage=60',
    });
  } catch (error) {
    console.error('[api/daily] failed', error);
    return jsonResponse({ error: 'daily-unavailable' }, 500);
  }
}
