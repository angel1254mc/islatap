import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { MultiPolygon } from '../src/lib/scoring.js';
import type { SqlExecutor, SqlRow } from './_lib/db.js';
import { setSqlForTest } from './_lib/db.js';
import handler, { GUESS_ROUND_SQL, parseAnswerRow, scoreGuess } from './guess.js';

const ROUND_ID = '11111111-1111-4111-8111-111111111111';

/** Kilometers per degree of latitude at EARTH_RADIUS_KM = 6371, as scoring.ts uses. */
const KM_PER_DEG_LAT = 111.19492664;

/** A 0.1-degree square straddling the south coast, in [lat, lng] order. */
const SQUARE: MultiPolygon = [
  [
    [
      [18.0, -66.5],
      [18.1, -66.5],
      [18.1, -66.4],
      [18.0, -66.4],
      [18.0, -66.5],
    ],
  ],
];

const SHAPE_ROW: SqlRow = {
  name: 'Cuadrado',
  municipio: 'Ponce',
  lat: 18.05,
  lng: -66.45,
  radius_km: null,
  geometry: SQUARE,
};

const CIRCLE_ROW: SqlRow = {
  name: 'Playa Flamenco',
  municipio: null,
  lat: 18.32,
  lng: -65.32,
  radius_km: 0.5,
  geometry: null,
};

function fakeSql(rows: SqlRow[]): SqlExecutor {
  return async (text) => {
    if (text !== GUESS_ROUND_SQL) throw new Error(`Unexpected SQL:\n${text}`);
    return rows;
  };
}

function post(body: unknown): Request {
  return new Request('https://islatap.test/api/guess', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  setSqlForTest(null);
});

describe('POST /api/guess — validation', () => {
  it('returns 400, not {"points": null}, for a null coordinate', async () => {
    // The headline regression. JSON.stringify(NaN) is "null", so this is
    // literally what a NaN guess looks like on the wire. Before validation it
    // sailed through Math.max(0, NaN) and came back as a 200 whose points field
    // was null — a scoreless round the client would happily add to the total.
    setSqlForTest(fakeSql([SHAPE_ROW]));

    const response = await handler(post({ roundId: ROUND_ID, lat: null, lng: -66.45 }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('points');
    expect(body.error).toBe('invalid-guess');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 400 for coordinates outside Puerto Rico', async () => {
    setSqlForTest(fakeSql([SHAPE_ROW]));
    const response = await handler(post({ roundId: ROUND_ID, lat: 999, lng: -66.45 }));
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty('points');
  });

  it('returns 400 for swapped lat/lng', async () => {
    setSqlForTest(fakeSql([SHAPE_ROW]));
    const response = await handler(post({ roundId: ROUND_ID, lat: -66.45, lng: 18.05 }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for a body that is not JSON', async () => {
    setSqlForTest(fakeSql([SHAPE_ROW]));
    const response = await handler(post('{ not json'));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid-json' });
  });

  it('never queries the database for an invalid body', async () => {
    // Validation runs before the round lookup, so garbage costs no round trip.
    setSqlForTest(async () => {
      throw new Error('the database must not be reached');
    });
    const response = await handler(post({ roundId: 'nope', lat: 18.05, lng: -66.45 }));
    expect(response.status).toBe(400);
  });

  it('rejects non-POST methods', async () => {
    const response = await handler(new Request('https://islatap.test/api/guess'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('returns 404 for an unknown round', async () => {
    setSqlForTest(fakeSql([]));
    const response = await handler(post({ roundId: ROUND_ID, lat: 18.05, lng: -66.45 }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'unknown-round' });
  });
});

describe('parseAnswerRow — corrupt rows', () => {
  it('throws rather than scoring against the Gulf of Guinea', () => {
    // Number(null) is 0, so a NULL latitude is NOT caught by a finiteness check
    // alone: it would sail through as a perfectly finite zero, score the player
    // against {lat: 0, lng: 0} and reveal that as the answer with a 200. A row
    // that violates the table's NOT NULL is an outage, not a guess.
    expect(() => parseAnswerRow({ ...SHAPE_ROW, lat: null })).toThrow(/non-finite/);
    expect(() => parseAnswerRow({ ...SHAPE_ROW, lng: null })).toThrow(/non-finite/);
    expect(() => parseAnswerRow({ ...SHAPE_ROW, lat: 'not a number' })).toThrow(/non-finite/);
    expect(() => parseAnswerRow({ ...SHAPE_ROW, lng: undefined })).toThrow(/non-finite/);
  });
});

describe('scoreGuess — SHAPE target', () => {
  const answer = parseAnswerRow(SHAPE_ROW);

  it('gives full marks inside the polygon and echoes the geometry it scored', () => {
    const result = scoreGuess(answer, { lat: 18.05, lng: -66.45 });
    expect(result.points).toBe(5000);
    expect(result.distanceKm).toBe(0);
    expect(result.inside).toBe(true);
    expect(result.target).toEqual({ type: 'SHAPE', geometry: SQUARE });
    expect(result.answer).toEqual({
      lat: 18.05,
      lng: -66.45,
      name: 'Cuadrado',
      municipio: 'Ponce',
    });
  });

  it('decays from the nearest boundary, not from the centre', () => {
    // 2 km north of the top edge: the centre is 2 km further away again, so
    // scoring from it would cost roughly 700 points.
    const result = scoreGuess(answer, { lat: 18.1 + 2 / KM_PER_DEG_LAT, lng: -66.45 });
    expect(result.inside).toBe(false);
    expect(result.distanceKm).toBeCloseTo(2, 1);
    expect(result.points).toBe(Math.round(5000 * Math.exp(-result.distanceKm / 10)));
  });
});

describe('scoreGuess — CIRCLE target', () => {
  const answer = parseAnswerRow(CIRCLE_ROW);

  it('gives full marks anywhere inside the acceptance radius', () => {
    const result = scoreGuess(answer, { lat: 18.32 + 0.4 / KM_PER_DEG_LAT, lng: -65.32 });
    expect(result.points).toBe(5000);
    expect(result.distanceKm).toBe(0);
    expect(result.inside).toBe(true);
    expect(result.target).toEqual({ type: 'CIRCLE', radiusKm: 0.5 });
    expect(result.answer.municipio).toBeNull();
  });

  it('decays from the circle edge', () => {
    const result = scoreGuess(answer, { lat: 18.32 + 0.6 / KM_PER_DEG_LAT, lng: -65.32 });
    expect(result.inside).toBe(false);
    expect(result.distanceKm).toBeCloseTo(0.1, 3);
  });

  it('falls back to the 50 m default when a row carries no radius', () => {
    // No row exercises this today (every shapeless location has an explicit
    // radiusKm), but the column is nullable and the client draws whatever
    // radius comes back, so the fallback must be a real number.
    const fallback = parseAnswerRow({ ...CIRCLE_ROW, radius_km: null, geometry: null });
    const result = scoreGuess(fallback, { lat: 18.32 + 0.03 / KM_PER_DEG_LAT, lng: -65.32 });
    expect(result.target).toEqual({ type: 'CIRCLE', radiusKm: 0.05 });
    expect(result.points).toBe(5000);
  });
});

describe('POST /api/guess — success', () => {
  it('scores a valid guess against a shape', async () => {
    setSqlForTest(fakeSql([SHAPE_ROW]));
    const response = await handler(post({ roundId: ROUND_ID, lat: 18.05, lng: -66.45 }));

    expect(response.status).toBe(200);
    // A guess response is specific to one player's tap and must never be cached.
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      points: number;
      inside: boolean;
      target: { type: string };
    };
    expect(body.points).toBe(5000);
    expect(body.inside).toBe(true);
    expect(body.target.type).toBe('SHAPE');
  });

  it('returns 500, not a 200 answering {lat: 0, lng: 0}, for a corrupt row', async () => {
    setSqlForTest(fakeSql([{ ...SHAPE_ROW, lat: null }]));
    const response = await handler(post({ roundId: ROUND_ID, lat: 18.05, lng: -66.45 }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'guess-unavailable' });
  });

  it('returns 500 rather than throwing when the database is unreachable', async () => {
    setSqlForTest(async () => {
      throw new Error('connection refused');
    });
    const response = await handler(post({ roundId: ROUND_ID, lat: 18.05, lng: -66.45 }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'guess-unavailable' });
  });
});

describe('guess.ts scores only through the shared target module', () => {
  // Task 4 extracted src/lib/target.ts specifically so this handler and the
  // client's reveal can never disagree about the same guess. Reaching past it
  // to a scoring primitive would rebuild that divergence, so the boundary is
  // asserted on the source text rather than left to code review.
  const FORBIDDEN = [
    'distanceToShapeKm',
    'pointInMultiPolygon',
    'distanceToCircleKm',
    'scoreForDistance',
  ];

  /** Every binding `file` imports, across single- and multi-line import statements. */
  const importedBindings = (file: string): string[] => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, file), 'utf8');
    return [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)].flatMap((match) =>
      match[1]
        .split(',')
        .map((binding) => binding.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean),
    );
  };

  it('imports none of the four scoring primitives', () => {
    const bindings = importedBindings('guess.ts');

    // Sanity-check the extractor itself, so this cannot pass by parsing nothing.
    expect(bindings).toContain('evaluateTarget');
    expect(bindings).toContain('targetForShapeOrRadius');

    for (const name of FORBIDDEN) {
      expect(bindings).not.toContain(name);
    }
  });
});

describe('GUESS_ROUND_SQL', () => {
  it('writes nothing', () => {
    // The guess endpoint is a pure function of (roundId, lat, lng). The only
    // write path in production is the nightly top-up job; anything else here
    // would need session state the design deliberately does not have.
    expect(GUESS_ROUND_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});
