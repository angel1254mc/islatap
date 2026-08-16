import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetShapesForTest } from './shapes';
import { loadPracticeGame, promptFromLocation, scorePracticeGuess } from './practice';
import type { GameLocation } from '../data/types';

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

afterEach(() => {
  resetShapesForTest();
  vi.unstubAllGlobals();
});

const POINT: GameLocation = {
  id: 79,
  name: 'Castillo San Felipe del Morro',
  municipio: null,
  category: 'landmark',
  subtype: 'landmark',
  difficulty: 'easy',
  source: 'curated',
  radiusKm: 0.15,
  lat: 18.4708,
  lng: -66.12399,
};

const SHAPED: GameLocation = {
  id: 110,
  name: 'Hato Rey',
  municipio: 'San Juan',
  category: 'barrio',
  subtype: 'barrio',
  difficulty: 'medium',
  source: 'curated',
  geoid: '72127-hato-rey',
  lat: 18.05,
  lng: -66.45,
};

describe('promptFromLocation', () => {
  it('carries the display fields and nothing positional', () => {
    expect(promptFromLocation(SHAPED)).toEqual({
      key: 'practice-110',
      name: 'Hato Rey',
      municipio: 'San Juan',
      category: 'barrio',
      subtype: 'barrio',
      difficulty: 'medium',
    });
  });
});

describe('loadPracticeGame', () => {
  it('returns five prompts backed by five locations and starts the shape load', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const game = await loadPracticeGame();
    expect(game.locations).toHaveLength(5);
    expect(game.prompts).toHaveLength(5);
    expect(game.prompts.map((p) => p.key)).toEqual(game.locations.map((l) => `practice-${l.id}`));
    // Boundary shapes are only needed by practice now, so practice is what
    // pays for them.
    expect(fetchMock).toHaveBeenCalledWith('/shapes-pr.json');
  });
});

describe('scorePracticeGuess', () => {
  it('scores a circle location against its acceptance radius', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const round = await scorePracticeGuess(POINT, { lat: 18.4708, lng: -66.12399 });
    expect(round.key).toBe('practice-79');
    expect(round.inside).toBe(true);
    expect(round.points).toBe(5000);
    expect(round.shape).toBeNull();
    expect(round.acceptRadiusKm).toBe(0.15);
    expect(round.answer).toEqual({
      lat: 18.4708,
      lng: -66.12399,
      name: 'Castillo San Felipe del Morro',
      municipio: null,
    });
  });

  it('scores a shaped location against its loaded boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ '72127-hato-rey': SQUARE }) }),
    );
    await loadPracticeGame(); // resolves the shape load
    const round = await scorePracticeGuess(SHAPED, { lat: 18.05, lng: -66.45 });
    expect(round.inside).toBe(true);
    expect(round.points).toBe(5000);
    expect(round.shape).toEqual(SQUARE);
    expect(round.acceptRadiusKm).toBeNull();
  });

  it('falls back to the default acceptance circle when the shape never loaded', async () => {
    // A dropped shapes-pr.json must degrade to a playable point round, not a
    // crash: practice is the only mode that scores locally, so there is no
    // server answer to fall back to.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await loadPracticeGame();
    const round = await scorePracticeGuess(SHAPED, { lat: 18.05, lng: -66.45 });
    expect(round.shape).toBeNull();
    expect(round.acceptRadiusKm).toBe(0.05);
    expect(round.inside).toBe(true);
  });
});
