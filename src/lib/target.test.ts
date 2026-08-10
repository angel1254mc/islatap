import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCEPT_RADIUS_KM, MAX_ROUND_POINTS, type MultiPolygon } from './scoring';
import { evaluateTarget, targetForShapeOrRadius } from './target';

// Along a meridian 1 km is 1/111.195 degrees of latitude, so distances built
// from latitude offsets agree with haversineKm to well under a meter. Same
// helper the existing game.test.ts uses, repeated rather than shared so this
// file stands alone.
const KM_PER_DEG_LAT = 111.19492664;
const kmNorthOf = (point: { lat: number; lng: number }, km: number) => ({
  lat: point.lat + km / KM_PER_DEG_LAT,
  lng: point.lng,
});

// 0.1 degree square spanning lat 18.0..18.1, lng -66.5..-66.4.
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

const CENTER = { lat: 18.05, lng: -66.45 };

describe('evaluateTarget — SHAPE', () => {
  it('awards full marks for a guess inside the polygon', () => {
    const verdict = evaluateTarget(CENTER, CENTER, { type: 'SHAPE', geometry: SQUARE });
    expect(verdict.inside).toBe(true);
    expect(verdict.distanceKm).toBe(0);
    expect(verdict.points).toBe(MAX_ROUND_POINTS);
  });

  it('decays from the nearest boundary, not from the centroid', () => {
    const guess = kmNorthOf({ lat: 18.1, lng: -66.45 }, 5);
    const verdict = evaluateTarget(guess, CENTER, { type: 'SHAPE', geometry: SQUARE });
    expect(verdict.inside).toBe(false);
    expect(verdict.distanceKm).toBeCloseTo(5, 2);
    expect(verdict.points).toBe(Math.round(MAX_ROUND_POINTS * Math.exp(-verdict.distanceKm / 10)));
  });

  it('ignores the center argument entirely for a shape', () => {
    // The SHAPE branch must never consult the answer point. Passing a wildly
    // wrong center has to change nothing, or a server that reads lat/lng from
    // a different column than the geometry could silently disagree with the
    // polygon it ships back to the client.
    const guess = kmNorthOf({ lat: 18.1, lng: -66.45 }, 5);
    const withRealCenter = evaluateTarget(guess, CENTER, { type: 'SHAPE', geometry: SQUARE });
    const withJunkCenter = evaluateTarget(guess, { lat: 0, lng: 0 }, { type: 'SHAPE', geometry: SQUARE });
    expect(withJunkCenter).toEqual(withRealCenter);
  });
});

describe('evaluateTarget — CIRCLE', () => {
  it('treats the acceptance circle as the boundary', () => {
    const verdict = evaluateTarget(kmNorthOf(CENTER, 0.03), CENTER, {
      type: 'CIRCLE',
      radiusKm: 0.05,
    });
    expect(verdict.inside).toBe(true);
    expect(verdict.distanceKm).toBe(0);
    expect(verdict.points).toBe(MAX_ROUND_POINTS);
  });

  it('starts the decay at the circle edge, not the center', () => {
    const verdict = evaluateTarget(kmNorthOf(CENTER, 2.05), CENTER, {
      type: 'CIRCLE',
      radiusKm: 0.05,
    });
    expect(verdict.inside).toBe(false);
    // 2.05 km from the point minus the 50 m radius = 2 km beyond the edge.
    expect(verdict.distanceKm).toBeCloseTo(2, 3);
    expect(verdict.points).toBe(Math.round(MAX_ROUND_POINTS * Math.exp(-2 / 10)));
  });

  it('honours a wide per-location radius', () => {
    const inside = evaluateTarget(kmNorthOf(CENTER, 0.4), CENTER, { type: 'CIRCLE', radiusKm: 0.5 });
    expect(inside.inside).toBe(true);
    expect(inside.points).toBe(MAX_ROUND_POINTS);

    const outside = evaluateTarget(kmNorthOf(CENTER, 0.6), CENTER, { type: 'CIRCLE', radiusKm: 0.5 });
    expect(outside.inside).toBe(false);
    expect(outside.distanceKm).toBeCloseTo(0.1, 3);
  });
});

describe('targetForShapeOrRadius', () => {
  it('prefers a shape when one is available', () => {
    expect(targetForShapeOrRadius(SQUARE, 0.5)).toEqual({ type: 'SHAPE', geometry: SQUARE });
  });

  it('falls back to the explicit radius when there is no shape', () => {
    expect(targetForShapeOrRadius(null, 0.5)).toEqual({ type: 'CIRCLE', radiusKm: 0.5 });
  });

  it('falls back to the default 50 m radius when there is neither', () => {
    // The 1088-row dataset has no such row today (the XOR is enforced in the
    // database), but the fallback keeps a shapeless, radiusless row scoring as
    // a tight point rather than crashing a request.
    expect(targetForShapeOrRadius(null, null)).toEqual({
      type: 'CIRCLE',
      radiusKm: DEFAULT_ACCEPT_RADIUS_KM,
    });
    expect(targetForShapeOrRadius(null, undefined)).toEqual({
      type: 'CIRCLE',
      radiusKm: DEFAULT_ACCEPT_RADIUS_KM,
    });
  });
});

// ---------------------------------------------------------------------------
// Import-boundary guard. api/guess.ts (Task 8) scores every production guess
// with evaluateTarget, so this module's dependency graph is a deployment
// constraint, not a style preference: target.ts may depend only on
// ./scoring.ts, and scoring.ts depends on nothing at all. Anything else --
// ../data/locations above all -- pulls all 1088 coordinates into the
// serverless bundle, and nothing else in the build would complain.
const HERE = dirname(fileURLToPath(import.meta.url));

/** Every module specifier a source file imports from. */
const importsOf = (file: string): string[] => {
  const source = readFileSync(join(HERE, file), 'utf8');
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
};

describe('target.ts stays importable from api/', () => {
  it('depends only on ./scoring, which depends on nothing', () => {
    expect(importsOf('target.ts')).toEqual(['./scoring']);
    expect(importsOf('scoring.ts')).toEqual([]);
  });

  it('scores a guess the way api/guess.ts will call it', () => {
    // The exact two-call shape api/guess.ts uses: build a target from the
    // joined row's geometry/radius, then evaluate against the row's point.
    const target = targetForShapeOrRadius(SQUARE, null);
    const verdict = evaluateTarget({ lat: 18.05, lng: -66.45 }, { lat: 18.05, lng: -66.45 }, target);

    expect(verdict).toEqual({ distanceKm: 0, points: 5000, inside: true });
  });
});
