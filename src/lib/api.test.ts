import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  fetchDaily,
  parseDailyPuzzle,
  parseGuessResult,
  resetApiForTest,
  submitGuess,
  userMessage,
} from './api';

// A minimal well-formed daily payload. Note what is NOT here: no geoid, no
// lat/lng, no radiusKm. That absence is the entire security property of the
// daily endpoint, so the fixture is deliberately spelled out in full rather
// than built by a helper that might quietly grow a coordinate field.
const DAILY_OK = {
  gameDate: '2026-08-05',
  rounds: [
    {
      roundId: '11111111-1111-4111-8111-111111111111',
      ordinal: 1,
      name: 'Hato Rey',
      municipio: 'San Juan',
      category: 'barrio',
      subtype: 'barrio',
      difficulty: 'medium',
    },
    {
      roundId: '22222222-2222-4222-8222-222222222222',
      ordinal: 2,
      name: 'Adjuntas',
      municipio: null,
      category: 'municipio',
      subtype: 'municipio',
      difficulty: 'hard',
    },
  ],
};

/**
 * A copy of the first round with one key removed. Written with `delete`
 * rather than a rest-destructure so there is no discarded binding for
 * noUnusedLocals to complain about.
 */
function roundWithout(key: string): Record<string, unknown> {
  const round: Record<string, unknown> = { ...DAILY_OK.rounds[0] };
  delete round[key];
  return round;
}

// 0.1 degree square. Points are [lat, lng] — Leaflet's tuple order, which is
// the inverse of GeoJSON. Everything downstream (pointInMultiPolygon,
// <Polygon positions>) indexes [0] as latitude, so the parser must not
// reorder or "fix" this.
const SQUARE = [
  [
    [
      [18.0, -66.5],
      [18.0, -66.4],
      [18.1, -66.4],
      [18.1, -66.5],
      [18.0, -66.5],
    ],
  ],
];

const GUESS_SHAPE_OK = {
  points: 4321,
  distanceKm: 1.5,
  inside: false,
  answer: { lat: 18.05, lng: -66.45, name: 'Hato Rey', municipio: 'San Juan' },
  target: { type: 'SHAPE', geometry: SQUARE },
};

const GUESS_CIRCLE_OK = {
  points: 5000,
  distanceKm: 0,
  inside: true,
  answer: { lat: 18.4708, lng: -66.12399, name: 'Castillo San Felipe del Morro', municipio: null },
  target: { type: 'CIRCLE', radiusKm: 0.15 },
};

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

afterEach(() => {
  resetApiForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchDaily', () => {
  it('parses a well-formed puzzle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(DAILY_OK)));
    const puzzle = await fetchDaily();
    expect(puzzle.gameDate).toBe('2026-08-05');
    expect(puzzle.rounds).toHaveLength(2);
    expect(puzzle.rounds[0].roundId).toBe('11111111-1111-4111-8111-111111111111');
    expect(puzzle.rounds[1].municipio).toBeNull();
    expect(puzzle.rounds[0].subtype).toBe('barrio');
    expect(puzzle.rounds[0].difficulty).toBe('medium');
  });

  it('fetches only once across repeated calls', async () => {
    // React 19 StrictMode double-invokes mount effects in dev, so the daily
    // fetch would fire twice per page load without this memo.
    const fetchMock = vi.fn().mockResolvedValue(okResponse(DAILY_OK));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([fetchDaily(), fetchDaily()]);
    await fetchDaily();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops the memo after a failure so a retry really retries', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse(DAILY_OK));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDaily()).rejects.toBeInstanceOf(ApiError);
    const puzzle = await fetchDaily();
    expect(puzzle.gameDate).toBe('2026-08-05');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a rejected fetch as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchDaily()).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports a non-2xx response as an http error carrying the status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(fetchDaily()).rejects.toMatchObject({ kind: 'http', status: 503 });
  });

  it('rejects a puzzle with no rounds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ gameDate: '2026-08-05', rounds: [] })));
    await expect(fetchDaily()).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('tags a daily failure with the daily request context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await expect(fetchDaily()).rejects.toMatchObject({ kind: 'http', status: 404, context: 'daily' });
  });

  it('refetches once the AST calendar date has moved past the cached gameDate', async () => {
    // A tab left open across midnight AST (e.g. sitting on the results screen
    // after finishing at 11:58 pm) must not hand "Play again" the same puzzle
    // it served hours earlier just because the in-flight-request memo never
    // expires on its own.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-09T20:00:00Z')); // 4:00 pm AST, Aug 9
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okResponse({ ...DAILY_OK, gameDate: '2026-08-09' }))
        .mockResolvedValueOnce(okResponse({ ...DAILY_OK, gameDate: '2026-08-10' }));
      vi.stubGlobal('fetch', fetchMock);

      const first = await fetchDaily();
      expect(first.gameDate).toBe('2026-08-09');

      // Still Aug 9 in AST — the memo should serve the same puzzle, not refetch.
      const second = await fetchDaily();
      expect(second.gameDate).toBe('2026-08-09');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 2026-08-10T04:00:00Z is exactly midnight AST on Aug 10 — the boundary.
      vi.setSystemTime(new Date('2026-08-10T05:00:00Z'));
      const third = await fetchDaily();
      expect(third.gameDate).toBe('2026-08-10');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parseDailyPuzzle', () => {
  it('rejects a missing or malformed gameDate', () => {
    expect(() => parseDailyPuzzle({ rounds: DAILY_OK.rounds })).toThrow(ApiError);
    expect(() => parseDailyPuzzle({ gameDate: '8/5/2026', rounds: DAILY_OK.rounds })).toThrow(ApiError);
  });

  it('rejects a round with an unknown category', () => {
    expect(() =>
      parseDailyPuzzle({
        gameDate: '2026-08-05',
        rounds: [{ ...DAILY_OK.rounds[0], category: 'planeta' }],
      }),
    ).toThrow(ApiError);
  });

  it('drops answer-bearing fields and warns loudly if the server ever sends them', () => {
    // A regression here is a silent cheat vector: anything that reaches the
    // browser can be read out of the network tab.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const puzzle = parseDailyPuzzle({
      gameDate: '2026-08-05',
      rounds: [{ ...DAILY_OK.rounds[0], lat: 18.42, lng: -66.05, geoid: '72127-hato-rey' }],
    });
    expect(warn).toHaveBeenCalled();
    expect(Object.keys(puzzle.rounds[0]).sort()).toEqual(
      ['category', 'difficulty', 'municipio', 'name', 'ordinal', 'roundId', 'subtype'].sort(),
    );
  });

  it('rejects a round missing subtype or difficulty', () => {
    // DailyRound declares both as required because api/daily.ts selects both
    // columns on every row. A payload without them did not come from this
    // server, and accepting it would hand the HUD an object that lies about
    // its own type — `prompt.subtype` typed as Subtype but actually undefined
    // would index SUBTYPE_LABELS with undefined and render nothing.
    expect(() =>
      parseDailyPuzzle({ gameDate: '2026-08-05', rounds: [roundWithout('subtype')] }),
    ).toThrow(ApiError);
    expect(() =>
      parseDailyPuzzle({ gameDate: '2026-08-05', rounds: [roundWithout('difficulty')] }),
    ).toThrow(ApiError);
  });
});

describe('submitGuess', () => {
  it('POSTs the roundId and coordinates as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(GUESS_SHAPE_OK));
    vi.stubGlobal('fetch', fetchMock);
    await submitGuess('round-abc', { lat: 18.2, lng: -66.7 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/guess');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ roundId: 'round-abc', lat: 18.2, lng: -66.7 });
  });

  it('parses a SHAPE target verbatim, preserving [lat, lng] point order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(GUESS_SHAPE_OK)));
    const result = await submitGuess('round-abc', { lat: 18.2, lng: -66.7 });
    expect(result.points).toBe(4321);
    expect(result.target).toEqual({ type: 'SHAPE', geometry: SQUARE });
    expect(result.answer).toEqual({ lat: 18.05, lng: -66.45, name: 'Hato Rey', municipio: 'San Juan' });
  });

  it('parses a CIRCLE target', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(GUESS_CIRCLE_OK)));
    const result = await submitGuess('round-abc', { lat: 18.47, lng: -66.12 });
    expect(result.inside).toBe(true);
    expect(result.target).toEqual({ type: 'CIRCLE', radiusKm: 0.15 });
  });

  it('rejects a null points value instead of rendering NaN in the HUD', () => {
    // JSON.stringify(NaN) is the literal `null`, so an unvalidated server can
    // ship {"points": null} with a 200. Catching it here keeps the number out
    // of totalScore, where it would poison every later round's running total.
    expect(() => parseGuessResult({ ...GUESS_SHAPE_OK, points: null })).toThrow(ApiError);
    expect(() => parseGuessResult({ ...GUESS_SHAPE_OK, distanceKm: null })).toThrow(ApiError);
  });

  it('rejects a SHAPE target whose geometry is not a 4-deep nested array', () => {
    expect(() =>
      parseGuessResult({ ...GUESS_SHAPE_OK, target: { type: 'SHAPE', geometry: {} } }),
    ).toThrow(ApiError);
    expect(() =>
      parseGuessResult({ ...GUESS_SHAPE_OK, target: { type: 'SHAPE', geometry: [[18.0, -66.5]] } }),
    ).toThrow(ApiError);
  });

  it('rejects a CIRCLE target with a non-positive radius', () => {
    expect(() =>
      parseGuessResult({ ...GUESS_CIRCLE_OK, target: { type: 'CIRCLE', radiusKm: 0 } }),
    ).toThrow(ApiError);
  });

  it('tags an unknown-round 404 with the guess request context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'unknown-round' }) }),
    );
    await expect(submitGuess('stale-round', { lat: 18.2, lng: -66.7 })).rejects.toMatchObject({
      kind: 'http',
      status: 404,
      context: 'guess',
    });
  });
});

describe('userMessage', () => {
  it('maps each error kind to distinct player-facing copy', () => {
    const messages = new Set([
      userMessage(new ApiError('network', 'x')),
      userMessage(new ApiError('timeout', 'x')),
      userMessage(new ApiError('http', 'x', 500)),
      userMessage(new ApiError('malformed', 'x')),
      userMessage(new Error('something else')),
    ]);
    expect(messages.size).toBe(5);
  });

  it('has dedicated copy for a puzzle that is not published yet', () => {
    expect(userMessage(new ApiError('http', 'HTTP 404', 404))).toMatch(/not ready/i);
  });

  it('gives a guess 404 its own copy instead of reusing the daily "not ready" message', () => {
    // /api/daily's 404 means today's puzzle doesn't exist yet; /api/guess's
    // 404 means the roundId is gone (api/guess.ts's 'unknown-round') — a
    // stale tab, not an unpublished day. Same status code, different failure.
    const dailyMessage = userMessage(new ApiError('http', 'HTTP 404', 404, 'daily'));
    const guessMessage = userMessage(new ApiError('http', 'HTTP 404', 404, 'guess'));
    expect(guessMessage).not.toBe(dailyMessage);
    expect(guessMessage).not.toMatch(/not ready/i);
    expect(dailyMessage).toMatch(/not ready/i);
  });
});
