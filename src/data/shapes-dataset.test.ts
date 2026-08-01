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

  it('stays under the size budget', () => {
    expect(statSync(SHAPES_PATH).size).toBeLessThan(3.5 * 1024 * 1024);
  });
});
