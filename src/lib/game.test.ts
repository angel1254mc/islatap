import { describe, expect, it } from 'vitest';
import { LOCATIONS, displayName, type GameLocation } from '../data/locations';
import { ROUNDS_PER_GAME, evaluateGuess, pickGameRounds, buildShareText } from './game';
import { MAX_ROUND_POINTS, type MultiPolygon } from './scoring';

// Puerto Rico's bounding box, generous enough to include Mona, Desecheo and Culebra.
const PR_BOUNDS = { minLat: 17.8, maxLat: 18.6, minLng: -67.95, maxLng: -65.2 };

describe('location dataset', () => {
  it('has unique ids', () => {
    const ids = LOCATIONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every location inside Puerto Rico', () => {
    const strays = LOCATIONS.filter(
      (l) =>
        l.lat < PR_BOUNDS.minLat || l.lat > PR_BOUNDS.maxLat ||
        l.lng < PR_BOUNDS.minLng || l.lng > PR_BOUNDS.maxLng,
    );
    expect(strays.map(displayName)).toEqual([]);
  });

  it('gives every prompt a globally unique display name', () => {
    // Bare barrio names collide constantly (Quebrada Arenas exists 6 times), so this
    // is the guard that the municipio qualifier is actually doing its job.
    const names = LOCATIONS.map(displayName);
    const seen = new Set<string>();
    const duplicates = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    expect(duplicates).toEqual([]);
  });

  it('qualifies every barrio-category location with a municipio', () => {
    const unqualified = LOCATIONS.filter((l) => l.category === 'barrio' && !l.municipio);
    expect(unqualified.map((l) => l.name)).toEqual([]);
  });

  it('gives every shapeless location an explicit acceptance radius', () => {
    // Without a shape, the acceptance circle is both the scoring boundary and
    // the reveal graphic. The 50 m fallback is sub-pixel at reveal zoom, so
    // every point-only location must declare a deliberate, visible radius.
    const silent = LOCATIONS.filter((l) => !l.geoid && !l.radiusKm);
    expect(silent.map(displayName)).toEqual([]);
  });

  it('leaves municipios and landmarks unqualified', () => {
    const qualified = LOCATIONS.filter(
      (l) => l.category !== 'barrio' && l.municipio !== null,
    );
    expect(qualified.map((l) => l.name)).toEqual([]);
  });
});

describe('pickGameRounds', () => {
  it('returns the right number of distinct locations', () => {
    for (let i = 0; i < 50; i++) {
      const rounds = pickGameRounds();
      expect(rounds).toHaveLength(ROUNDS_PER_GAME);
      expect(new Set(rounds.map((r) => r.id)).size).toBe(ROUNDS_PER_GAME);
    }
  });

  it('always includes one of each category', () => {
    for (let i = 0; i < 50; i++) {
      const categories = new Set(pickGameRounds().map((r) => r.category));
      expect([...categories].sort()).toEqual(['barrio', 'landmark', 'municipio']);
    }
  });

  it('does not let barrios crowd out the other categories', () => {
    // Barrios outnumber everything else ~11:1, so a flat draw for the two
    // unguaranteed slots would push this ratio to ~0.78. Per-category filling
    // should keep it near 3/5 = 0.6.
    const runs = 400;
    let barrios = 0;
    for (let i = 0; i < runs; i++) {
      barrios += pickGameRounds().filter((r) => r.category === 'barrio').length;
    }
    expect(barrios / (runs * ROUNDS_PER_GAME)).toBeLessThan(0.7);
  });

  it('falls back gracefully when a pool is smaller than a full game', () => {
    const rounds = pickGameRounds(LOCATIONS.slice(0, 3));
    expect(rounds).toHaveLength(3);
  });
});

describe('buildShareText', () => {
  const base = {
    location: LOCATIONS[0],
    guess: { lat: 18.2, lng: -66.7 },
  };

  it('shows the distance for outside guesses', () => {
    const text = buildShareText(
      [{ ...base, distanceKm: 12.3, points: 1450, inside: false, shape: null, acceptRadiusKm: null }],
      1450,
    );
    expect(text).toContain('12.3 km');
    expect(text).not.toContain('¡Adentro!');
  });

  it('shows ¡Adentro! instead of a distance for inside guesses', () => {
    const text = buildShareText(
      [{ ...base, distanceKm: 0, points: 5000, inside: true, shape: null, acceptRadiusKm: null }],
      5000,
    );
    expect(text).toContain('¡Adentro!');
    expect(text).not.toContain('0 m');
  });
});

describe('evaluateGuess', () => {
  // Along a meridian 1 km ≈ 1/111.195 degrees of latitude, so distances built
  // from latitude offsets match haversineKm to well under a meter.
  const KM_PER_DEG_LAT = 111.19492664;
  const kmNorthOf = (location: { lat: number; lng: number }, km: number) => ({
    lat: location.lat + km / KM_PER_DEG_LAT,
    lng: location.lng,
  });

  const point = (overrides: Partial<GameLocation>): GameLocation => ({
    id: 9999,
    name: 'Test Point',
    municipio: null,
    category: 'landmark',
    subtype: 'landmark',
    difficulty: 'easy',
    source: 'curated',
    lat: 18.4,
    lng: -66.1,
    ...overrides,
  });

  // 0.1° square around (18.0..18.1, -66.5..-66.4).
  const SQUARE: MultiPolygon = [
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

  it('scores a shaped round from the boundary, full marks inside', () => {
    const location = point({ geoid: '72999', lat: 18.05, lng: -66.45 });
    const inside = evaluateGuess(location, { lat: 18.05, lng: -66.45 }, SQUARE);
    expect(inside.inside).toBe(true);
    expect(inside.points).toBe(MAX_ROUND_POINTS);
    expect(inside.acceptRadiusKm).toBeNull();

    const outside = evaluateGuess(location, kmNorthOf({ lat: 18.1, lng: -66.45 }, 5), SQUARE);
    expect(outside.inside).toBe(false);
    expect(outside.distanceKm).toBeCloseTo(5, 2);
    expect(outside.acceptRadiusKm).toBeNull();
  });

  it('gives full marks within the default 50 m acceptance circle', () => {
    const location = point({});
    const outcome = evaluateGuess(location, kmNorthOf(location, 0.03), null);
    expect(outcome.inside).toBe(true);
    expect(outcome.distanceKm).toBe(0);
    expect(outcome.points).toBe(MAX_ROUND_POINTS);
    expect(outcome.acceptRadiusKm).toBe(0.05);
  });

  it('starts the decay at the circle edge, not the center', () => {
    const location = point({});
    const outcome = evaluateGuess(location, kmNorthOf(location, 2.05), null);
    expect(outcome.inside).toBe(false);
    // 2.05 km from the point minus the 50 m radius = 2 km from the edge.
    expect(outcome.distanceKm).toBeCloseTo(2, 3);
    expect(outcome.points).toBe(Math.round(MAX_ROUND_POINTS * Math.exp(-2 / 10)));
    expect(outcome.acceptRadiusKm).toBe(0.05);
  });

  it('honors a per-location radius override', () => {
    const location = point({ radiusKm: 0.5 });
    const insideWide = evaluateGuess(location, kmNorthOf(location, 0.4), null);
    expect(insideWide.inside).toBe(true);
    expect(insideWide.points).toBe(MAX_ROUND_POINTS);
    expect(insideWide.acceptRadiusKm).toBe(0.5);

    const justOutside = evaluateGuess(location, kmNorthOf(location, 0.6), null);
    expect(justOutside.inside).toBe(false);
    expect(justOutside.distanceKm).toBeCloseTo(0.1, 3);
  });
});
