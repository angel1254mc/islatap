import type { GuessResponse } from '../src/lib/api-types.js';
import type { LatLng, MultiPolygon } from '../src/lib/scoring.js';
import { evaluateTarget, targetForShapeOrRadius } from '../src/lib/target.js';
import { todayInAst } from './_lib/date.js';
import { getSql, type SqlRow } from './_lib/db.js';
import { jsonResponse } from './_lib/http.js';
import { guessBodySchema } from './_lib/validation.js';

export const config = { runtime: 'nodejs' };

/**
 * Resolve an opaque round handle to the answer it hides.
 *
 * LEFT JOIN, not JOIN: 25 of the 1088 locations have no geoid and therefore no
 * shape row — they are scored against an acceptance circle instead. The join
 * being outer is what makes the SHAPE|CIRCLE discriminant fall out of the data
 * rather than out of a flag.
 *
 * The game_date guard costs nothing and means a round id can never be used to
 * score a puzzle that has not happened yet — the buffer holds 30 days of future
 * rounds, and none of them should be answerable early even if an id leaked.
 */
export const GUESS_ROUND_SQL = `
SELECT l.name,
       l.municipio,
       l.lat,
       l.lng,
       l.radius_km,
       s.geometry
  FROM puzzle_round pr
  JOIN location l ON l.id = pr.location_id
  LEFT JOIN shape s ON s.geoid = l.geoid
 WHERE pr.id = $1::uuid
   AND pr.game_date <= $2::date
`;

export interface AnswerRow {
  name: string;
  municipio: string | null;
  lat: number;
  lng: number;
  radiusKm: number | null;
  /**
   * Leaflet-ordered MultiPolygon straight out of the jsonb column — points are
   * [lat, lng], not GeoJSON's [lng, lat]. Every helper in src/lib/scoring.ts
   * indexes ring[i][0] as latitude, and react-leaflet's <Polygon positions>
   * wants the same order, so this value travels from seed to browser untouched.
   */
  geometry: MultiPolygon | null;
}

/**
 * Decode one row of GUESS_ROUND_SQL, refusing to guess about a corrupt one.
 *
 * The coordinate guard is the server-side mirror of guessBodySchema: the same
 * unguarded arithmetic sits downstream of both, and a bad number from the
 * database is no less poisonous than a bad number from the client.
 */
export function parseAnswerRow(row: SqlRow): AnswerRow {
  // Nullish first, because Number(null) is 0 — a perfectly finite zero that the
  // check below would wave through, scoring the player against the Gulf of
  // Guinea and revealing {lat: 0, lng: 0} as the answer with a 200. Number(
  // undefined) and Number('abc') are NaN and land in the same guard.
  const lat = row.lat === null || row.lat === undefined ? Number.NaN : Number(row.lat);
  const lng = row.lng === null || row.lng === undefined ? Number.NaN : Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    // Thrown, not defaulted: location.lat/lng are NOT NULL with CHECK bounds, so
    // reaching here means the data is broken. That is an outage, and the
    // handler's catch turns it into a 500 — never a scored round.
    throw new Error(`location row has non-finite coordinates: ${row.lat}, ${row.lng}`);
  }

  return {
    name: String(row.name),
    municipio: row.municipio === null || row.municipio === undefined ? null : String(row.municipio),
    lat,
    lng,
    radiusKm: row.radius_km === null || row.radius_km === undefined ? null : Number(row.radius_km),
    geometry: (row.geometry ?? null) as MultiPolygon | null,
  };
}

/**
 * Score a guess.
 *
 * All of the geometry lives in src/lib/target.ts, which the browser's
 * evaluateGuess() also calls: the server and the client run the *same function*
 * over the same discriminated union, so they cannot disagree about what a round
 * is worth. Re-deriving the two branches here with distanceToShapeKm /
 * pointInMultiPolygon / distanceToCircleKm would recreate exactly the drift the
 * extraction removed — and would ray-cast twice, since distanceToShapeKm calls
 * pointInMultiPolygon internally.
 *
 * The returned target is the geometry that was *actually scored*, which is what
 * lets the client draw the reveal without a second source of truth.
 */
export function scoreGuess(answer: AnswerRow, guess: LatLng): GuessResponse {
  const revealed = {
    lat: answer.lat,
    lng: answer.lng,
    name: answer.name,
    municipio: answer.municipio,
  };

  // A shape always wins; radiusKm (with its 50 m default) is the fallback for
  // the 25 shapeless locations. Same helper the client uses.
  const target = targetForShapeOrRadius(answer.geometry, answer.radiusKm);
  const verdict = evaluateTarget(guess, { lat: answer.lat, lng: answer.lng }, target);

  return {
    points: verdict.points,
    distanceKm: verdict.distanceKm,
    inside: verdict.inside,
    answer: revealed,
    target,
  };
}

/**
 * A pure function with zero writes: no session, no cookie, no row touched.
 * Replaying the same guess returns the same answer, which is deliberate — the
 * player's history lives in their own localStorage, and there is nothing here
 * worth cheating past that is not already revealed by the response itself.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method-not-allowed' }, 405, { allow: 'POST' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid-json' }, 400);
  }

  // Validate BEFORE the round lookup: a malformed body should cost a database
  // round trip no more than it should reach the scorer.
  const parsed = guessBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: 'invalid-guess',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }

  const { roundId, lat, lng } = parsed.data;

  try {
    const rows = await getSql()(GUESS_ROUND_SQL, [roundId, todayInAst()]);
    if (rows.length === 0) {
      // Either the uuid is invented, or it belongs to a puzzle that has not run
      // yet. Both are "there is no such round to score" from here.
      return jsonResponse({ error: 'unknown-round' }, 404);
    }
    // parseAnswerRow throws on a corrupt row; that lands in the catch below as a
    // 500, which is the honest answer for broken data.
    const result = scoreGuess(parseAnswerRow(rows[0]), { lat, lng });
    return jsonResponse(result, 200, {
      // Specific to one tap, and it contains the answer. Nothing may cache it.
      'cache-control': 'no-store',
    });
  } catch (error) {
    console.error('[api/guess] failed', error);
    return jsonResponse({ error: 'guess-unavailable' }, 500);
  }
}
