import { describe, expect, it } from 'vitest';
import { assertSeedInvariants, extractArrayLiteral, loadSeedData } from './seed.mjs';
// Vitest resolves and transpiles the .ts module, so this is exactly what the
// application sees at runtime. Comparing it against the text-extracted copy is
// the only thing that makes the extraction hack trustworthy.
import { LOCATIONS } from '../src/data/locations';

describe('extractArrayLiteral', () => {
  it('slices out the literal between the declaration and the final bracket', () => {
    const source = [
      "import type { GameLocation } from './types';",
      '',
      'export const THINGS: GameLocation[] = [',
      "  { id: 1, name: 'a' },",
      '];',
      '',
    ].join('\n');

    expect(extractArrayLiteral(source, 'THINGS')).toBe("[\n  { id: 1, name: 'a' },\n]");
  });

  it('throws when the export is missing rather than returning garbage', () => {
    expect(() => extractArrayLiteral('const x = 1;', 'THINGS')).toThrow(/THINGS/);
  });

  it('throws when a second array export appears', () => {
    // lastIndexOf('];') would silently swallow both arrays into one literal.
    // Refusing is the only safe answer if someone adds a second export later.
    const source = [
      'export const THINGS: GameLocation[] = [',
      '];',
      'export const THINGS: GameLocation[] = [',
      '];',
    ].join('\n');
    expect(() => extractArrayLiteral(source, 'THINGS')).toThrow(/more than once/i);
  });
});

describe('loadSeedData', () => {
  const data = loadSeedData();

  it('reproduces the TypeScript module exactly', () => {
    // If this ever fails, the text-slice extraction has drifted from what tsc
    // sees and the database would be seeded from a different dataset than the
    // one the tests validate.
    expect(data.locations).toEqual(LOCATIONS);
  });

  it('loads the full pool with the expected category mix', () => {
    expect(data.locations).toHaveLength(1088);

    const byCategory = { municipio: 0, landmark: 0, barrio: 0 };
    for (const location of data.locations) byCategory[location.category]++;

    // The landmark count is the number that drives the whole generation
    // design: 26 landmarks at one per day lasts 26 days, which is why the
    // daily mix only spends one every third day.
    expect(byCategory).toEqual({ municipio: 78, landmark: 26, barrio: 984 });
  });

  it('loads every shape key, including the unreferenced ones', () => {
    expect(Object.keys(data.shapes)).toHaveLength(1422);
  });

  it('keeps shape coordinates in Leaflet [lat, lng] order, not GeoJSON order', () => {
    // Adjuntas municipio. Latitude first. If this ever reads [-66.8, 18.1],
    // someone converted the file to GeoJSON and every geometry helper in
    // src/lib/scoring.ts is now silently computing nonsense.
    const [lat, lng] = data.shapes['72001'][0][0][0];
    expect(lat).toBeGreaterThan(17);
    expect(lat).toBeLessThan(19);
    expect(lng).toBeLessThan(-60);
  });
});

describe('assertSeedInvariants', () => {
  it('passes on the real dataset', () => {
    expect(() => assertSeedInvariants(loadSeedData())).not.toThrow();
  });

  it('rejects a location with neither geoid nor radiusKm', () => {
    // Such a row is neither a SHAPE target nor a CIRCLE target -- /api/guess
    // would have nothing to score against. Catch it here with a readable
    // message rather than as a Postgres constraint violation mid-batch.
    expect(() =>
      assertSeedInvariants({
        locations: [
          {
            id: 1, name: 'Nowhere', municipio: null, category: 'landmark',
            subtype: 'landmark', difficulty: 'easy', source: 'curated',
            lat: 18.4, lng: -66.1,
          },
        ],
        shapes: {},
      }),
    ).toThrow(/exactly one of geoid/i);
  });

  it('rejects a location with both geoid and radiusKm', () => {
    expect(() =>
      assertSeedInvariants({
        locations: [
          {
            id: 1, name: 'Both', municipio: null, category: 'landmark',
            subtype: 'landmark', difficulty: 'easy', source: 'curated',
            geoid: '72001', radiusKm: 0.5, lat: 18.4, lng: -66.1,
          },
        ],
        shapes: { 72001: [] },
      }),
    ).toThrow(/exactly one of geoid/i);
  });

  it('rejects a geoid with no matching shape', () => {
    // location.geoid is a foreign key to shape.geoid. A dangling reference
    // fails the insert 1000 rows in, after a lot of wasted round trips.
    expect(() =>
      assertSeedInvariants({
        locations: [
          {
            id: 1, name: 'Ghost', municipio: null, category: 'municipio',
            subtype: 'municipio', difficulty: 'easy', source: 'geonames',
            geoid: '99999', lat: 18.4, lng: -66.1,
          },
        ],
        shapes: {},
      }),
    ).toThrow(/99999/);
  });

  it('rejects coordinates outside the greater-Puerto-Rico envelope', () => {
    // Mirrors the CHECK constraints in migrations/001_initial.sql. A swapped
    // lat/lng pair lands here rather than in the database.
    expect(() =>
      assertSeedInvariants({
        locations: [
          {
            id: 1, name: 'Swapped', municipio: null, category: 'landmark',
            subtype: 'landmark', difficulty: 'easy', source: 'curated',
            radiusKm: 0.5, lat: -66.1, lng: 18.4,
          },
        ],
        shapes: {},
      }),
    ).toThrow(/out of bounds/i);
  });

  it('rejects duplicate ids', () => {
    const row = {
      id: 7, name: 'Twin', municipio: null, category: 'landmark',
      subtype: 'landmark', difficulty: 'easy', source: 'curated',
      radiusKm: 0.5, lat: 18.4, lng: -66.1,
    };
    expect(() => assertSeedInvariants({ locations: [row, { ...row }], shapes: {} }))
      .toThrow(/duplicate location id/i);
  });
});
