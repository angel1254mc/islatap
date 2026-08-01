import { describe, expect, it } from 'vitest';
import { LOCATIONS, displayName } from '../data/locations';
import { ROUNDS_PER_GAME, pickGameRounds, buildShareText } from './game';

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
      [{ ...base, distanceKm: 12.3, points: 1450, inside: false, shape: null }],
      1450,
    );
    expect(text).toContain('12.3 km');
    expect(text).not.toContain('¡Adentro!');
  });

  it('shows ¡Adentro! instead of a distance for inside guesses', () => {
    const text = buildShareText(
      [{ ...base, distanceKm: 0, points: 5000, inside: true, shape: null }],
      5000,
    );
    expect(text).toContain('¡Adentro!');
    expect(text).not.toContain('0 m');
  });
});
