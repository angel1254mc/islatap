import { afterEach, describe, expect, it } from 'vitest';
import type { SqlExecutor, SqlRow } from './_lib/db.js';
import { setSqlForTest } from './_lib/db.js';
import { GET as handler, DAILY_ROUNDS_SQL, toDailyPayload } from './daily.js';

/**
 * Rows shaped as the driver would hand them back — plus the columns the query
 * must never select. Feeding them in on purpose proves the mapper builds its
 * output field by field rather than spreading whatever the database returned.
 */
const LEAKY_ROWS: SqlRow[] = [
  {
    round_id: '11111111-1111-4111-8111-111111111111',
    ordinal: 1,
    name: 'Santurce',
    municipio: 'San Juan',
    category: 'barrio',
    subtype: 'barrio',
    difficulty: 'medium',
    // Everything below is contraband.
    id: 907,
    location_id: 907,
    geoid: '7212779693',
    lat: 18.4477,
    lng: -66.0561,
    radius_km: null,
  },
  {
    round_id: '22222222-2222-4222-8222-222222222222',
    ordinal: 2,
    name: 'Castillo San Felipe del Morro',
    municipio: null,
    category: 'landmark',
    subtype: 'landmark',
    difficulty: 'easy',
    geoid: null,
    lat: 18.4708,
    lng: -66.12399,
    radius_km: 0.15,
  },
];

function fakeSql(rows: SqlRow[]): SqlExecutor {
  return async (text, params = []) => {
    if (text !== DAILY_ROUNDS_SQL) throw new Error(`Unexpected SQL:\n${text}`);
    if (typeof params[0] !== 'string') throw new Error('game_date must be bound as a string');
    return rows;
  };
}

afterEach(() => {
  setSqlForTest(null);
});

describe('DAILY_ROUNDS_SQL', () => {
  it('selects nothing that could locate an answer', () => {
    // Defence one of two: the query cannot return what it does not ask for.
    expect(DAILY_ROUNDS_SQL).not.toMatch(/\bl\.lat\b/);
    expect(DAILY_ROUNDS_SQL).not.toMatch(/\bl\.lng\b/);
    expect(DAILY_ROUNDS_SQL).not.toMatch(/geoid/i);
    expect(DAILY_ROUNDS_SQL).not.toMatch(/radius_km/i);

    // The id checks have to be scoped to the projection, not the whole query:
    // resolving a round to its prompt *requires* `JOIN location l ON l.id =
    // pr.location_id`, so a whole-query `not.toMatch(/l\.id/)` can never pass
    // and would only prove the assertion was never run. What matters is that
    // neither identifier reaches the SELECT list.
    const selectList = DAILY_ROUNDS_SQL.slice(0, DAILY_ROUNDS_SQL.search(/\bFROM\b/));
    expect(selectList).not.toMatch(/\bl\.id\b/);
    expect(selectList).not.toMatch(/\blocation_id\b/);

    expect(DAILY_ROUNDS_SQL).toMatch(/ORDER BY pr\.ordinal/i);
  });
});

describe('toDailyPayload', () => {
  it('carries no geoid, no coordinates and no stable location id', () => {
    // Defence two: even handed rows full of contraband, the mapper emits only
    // the seven prompt fields. The stable location.id is as dangerous as the
    // coordinates — it is the key a scraper would build an id -> lat/lng
    // dictionary around, which is the entire reason puzzle_round.id exists.
    const payload = toDailyPayload('2026-08-05', LEAKY_ROWS);
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('geoid');
    expect(serialized).not.toContain('lat');
    expect(serialized).not.toContain('lng');
    expect(serialized).not.toContain('radius');
    expect(serialized).not.toContain('location_id');
    expect(serialized).not.toContain('18.4477');
    expect(serialized).not.toContain('-66.0561');
    expect(serialized).not.toContain('18.4708');
    expect(serialized).not.toContain('0.15');

    // Structural, not substring: asserting the id 907 is absent by searching
    // the JSON text is a trap, because every RFC-4122 v4 uuid carries a literal
    // '4' in its third group ('...-4222-...'), so any short digit string
    // eventually collides with a round id and the test fails for a reason that
    // has nothing to do with a leak. Check for the *keys* instead.
    for (const round of payload.rounds) {
      expect('locationId' in round).toBe(false);
      expect('id' in round).toBe(false);
    }
    expect(payload.rounds.some((round) => 'locationId' in round || 'id' in round)).toBe(false);
  });

  it('keeps exactly the fields the prompt renders', () => {
    const payload = toDailyPayload('2026-08-05', LEAKY_ROWS);
    expect(payload.gameDate).toBe('2026-08-05');
    expect(payload.rounds).toHaveLength(2);
    expect(payload.rounds[0]).toEqual({
      roundId: '11111111-1111-4111-8111-111111111111',
      ordinal: 1,
      name: 'Santurce',
      municipio: 'San Juan',
      category: 'barrio',
      subtype: 'barrio',
      difficulty: 'medium',
    });
    expect(Object.keys(payload.rounds[0])).toHaveLength(7);
  });

  it('preserves a null municipio rather than turning it into a string', () => {
    // 104 of 1088 locations (every municipio and every landmark) have no parent
    // municipio, and displayName() branches on exactly this null.
    expect(toDailyPayload('2026-08-05', LEAKY_ROWS).rounds[1].municipio).toBeNull();
  });
});

describe('GET /api/daily', () => {
  it('returns today AST and the day’s rounds in ordinal order', async () => {
    setSqlForTest(fakeSql(LEAKY_ROWS));
    const response = await handler(new Request('https://islatap.test/api/daily'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { gameDate: string; rounds: { ordinal: number }[] };
    expect(body.gameDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.rounds.map((round) => round.ordinal)).toEqual([1, 2]);
  });

  it('returns 503 when the buffer has a hole rather than an empty game', async () => {
    // An empty rounds array would start a zero-round game in the browser. A 503
    // is the honest answer and gives the client something to show an error for.
    setSqlForTest(fakeSql([]));
    const response = await handler(new Request('https://islatap.test/api/daily'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'no-puzzle' });
    expect(response.headers.get('retry-after')).toBe('300');
  });

  it('rejects non-GET methods', async () => {
    setSqlForTest(fakeSql(LEAKY_ROWS));
    const response = await handler(
      new Request('https://islatap.test/api/daily', { method: 'POST' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('returns 500 rather than throwing when the database is unreachable', async () => {
    setSqlForTest(async () => {
      throw new Error('connection refused');
    });
    const response = await handler(new Request('https://islatap.test/api/daily'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'daily-unavailable' });
  });
});
