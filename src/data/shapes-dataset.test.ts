import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from '../lib/scoring';
import { LOCATIONS } from './locations';

const SHAPES_PATH = fileURLToPath(new URL('../../public/shapes-pr.json', import.meta.url));

function loadShapes(): Record<string, MultiPolygon> {
  return JSON.parse(readFileSync(SHAPES_PATH, 'utf8'));
}

describe('public/shapes-pr.json', () => {
  it('has a shape for every location that declares a geoid', () => {
    const shapes = loadShapes();
    const missing = LOCATIONS.filter((l) => l.geoid && !shapes[l.geoid]).map(
      (l) => `${l.name} (${l.geoid})`,
    );
    expect(missing).toEqual([]);
  });

  it('keeps every shape inside greater Puerto Rico bounds', () => {
    // Generous: includes territorial water in county polygons, Mona, Desecheo, Culebra cays.
    const shapes = loadShapes();
    const strays: string[] = [];
    for (const [geoid, shape] of Object.entries(shapes)) {
      for (const part of shape) {
        for (const ring of part) {
          for (const [lat, lng] of ring) {
            if (lat < 17.5 || lat > 18.8 || lng < -68.2 || lng > -64.9) {
              strays.push(geoid);
            }
          }
        }
      }
    }
    expect([...new Set(strays)]).toEqual([]);
  });

  it('has well-formed rings (≥ 4 points, closed)', () => {
    const shapes = loadShapes();
    const bad: string[] = [];
    for (const [geoid, shape] of Object.entries(shapes)) {
      for (const part of shape) {
        for (const ring of part) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (ring.length < 4 || first[0] !== last[0] || first[1] !== last[1]) {
            bad.push(geoid);
          }
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it('contains the three flagship geoids', () => {
    const shapes = loadShapes();
    expect(shapes['72127']).toBeDefined(); // San Juan municipio (county)
    expect(shapes['7212779693']).toBeDefined(); // Santurce barrio (cousub)
    expect(shapes['721277969319927']).toBeDefined(); // Condado subbarrio
  });

  it('merges Hato Rey Norte + Central + Sur into the umbrella shape', () => {
    const shapes = loadShapes();
    const merged = shapes['72127-hato-rey'];
    expect(merged).toBeDefined();
    const sourceParts =
      shapes['7212734027'].length + shapes['7212733984'].length + shapes['7212734070'].length;
    expect(merged.length).toBe(sourceParts);
  });

  it('gives every island landmark a real single-island shape', () => {
    // Each key is one part extracted from its municipio's shape — the part
    // containing the landmark point — so the polygon is the island itself,
    // never the whole multi-island municipio.
    const shapes = loadShapes();
    for (const key of [
      '72147-isla-de-vieques',
      '72049-isla-de-culebra',
      '72097-isla-de-mona',
      '72113-isla-caja-de-muertos',
      '72097-isla-desecheo',
    ]) {
      expect(shapes[key], key).toBeDefined();
      expect(shapes[key].length, `${key} should be a single island part`).toBe(1);
    }
  });

  it('links curated Guavate to its official Census barrio', () => {
    const guavate = LOCATIONS.find((l) => l.name === 'Guavate');
    expect(guavate?.geoid).toBe('7203531834');
    expect(loadShapes()['7203531834']).toBeDefined();
  });

  it('gives every curated municipio a county shape', () => {
    const shapes = loadShapes();
    const missing = LOCATIONS.filter(
      (l) => l.category === 'municipio' && (!l.geoid || !shapes[l.geoid]),
    ).map((l) => l.name);
    expect(missing).toEqual([]);
  });

  it('stays under the size budget', () => {
    expect(statSync(SHAPES_PATH).size).toBeLessThan(3.5 * 1024 * 1024);
  });

  it('uses shoreline-clipped boundaries, not legal ones that extend into the ocean', () => {
    // TIGER/Line ships LEGAL boundaries: coastal units include territorial water
    // (Isabela's county polygon reached ~5.7 km into the Atlantic). Shapes must come
    // from the cartographic-boundary (cb_*_500k) files instead. These two anchors are
    // the shoreline latitudes from cb 2022; regressing to TIGER geometry breaks both.
    const shapes = loadShapes();
    const maxLat = (shape: MultiPolygon) =>
      Math.max(...shape.flatMap((part) => part.flatMap((ring) => ring.map(([lat]) => lat))));
    expect(maxLat(shapes['72071'])).toBeLessThan(18.52); // Isabela municipio (TIGER: 18.568)
    expect(maxLat(shapes['7208783133'])).toBeLessThan(18.462); // Torrecilla Baja, Loíza (TIGER: 18.4656)
  });

  it('never lets two locations share a geoid (the same polygon would be promptable twice)', () => {
    const geoids = LOCATIONS.map((l) => l.geoid).filter((g): g is string => Boolean(g));
    const seen = new Set<string>();
    const duplicates = geoids.filter((g) => (seen.has(g) ? true : (seen.add(g), false)));
    expect([...new Set(duplicates)]).toEqual([]);
  });
});
