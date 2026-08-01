import { describe, expect, it } from 'vitest';
import {
  distanceToShapeKm,
  nearestPointOnShape,
  pointInMultiPolygon,
  scoreForDistance,
  type MultiPolygon,
} from './scoring';

// 0.1° square in southwest PR: lat 18.0–18.1, lng -66.5–-66.4.
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

// Same square with a centered hole: lat 18.02–18.08, lng -66.48–-66.42.
const DONUT: MultiPolygon = [
  [
    SQUARE[0][0],
    [
      [18.02, -66.48],
      [18.02, -66.42],
      [18.08, -66.42],
      [18.08, -66.48],
      [18.02, -66.48],
    ],
  ],
];

// Two separate squares (multipolygon): SQUARE plus a far one near Vieques.
const TWO_PARTS: MultiPolygon = [
  SQUARE[0],
  [
    [
      [18.1, -65.5],
      [18.1, -65.4],
      [18.2, -65.4],
      [18.2, -65.5],
      [18.1, -65.5],
    ],
  ],
];

describe('pointInMultiPolygon', () => {
  it('detects a point inside', () => {
    expect(pointInMultiPolygon({ lat: 18.05, lng: -66.45 }, SQUARE)).toBe(true);
  });

  it('detects a point outside', () => {
    expect(pointInMultiPolygon({ lat: 17.95, lng: -66.45 }, SQUARE)).toBe(false);
  });

  it('treats a point in a hole as outside', () => {
    expect(pointInMultiPolygon({ lat: 18.05, lng: -66.45 }, DONUT)).toBe(false);
  });

  it('still detects the ring of a donut', () => {
    // Between outer (18.0) and hole (18.02).
    expect(pointInMultiPolygon({ lat: 18.01, lng: -66.45 }, DONUT)).toBe(true);
  });

  it('checks every part of a multipolygon', () => {
    expect(pointInMultiPolygon({ lat: 18.15, lng: -65.45 }, TWO_PARTS)).toBe(true);
  });
});

describe('distanceToShapeKm', () => {
  it('returns 0 inside', () => {
    expect(distanceToShapeKm({ lat: 18.05, lng: -66.45 }, SQUARE)).toBe(0);
  });

  it('measures to the nearest edge outside', () => {
    // 0.05° of latitude south of the bottom edge ≈ 5.57 km.
    const d = distanceToShapeKm({ lat: 17.95, lng: -66.45 }, SQUARE);
    expect(d).toBeCloseTo(5.57, 1);
  });

  it('measures to the hole edge from within a hole', () => {
    // Center of the hole; nearest edge is the hole's lng wall ≈ 3.2 km.
    const d = distanceToShapeKm({ lat: 18.05, lng: -66.45 }, DONUT);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(3.5);
  });

  it('uses the nearest part of a multipolygon', () => {
    // Just east of the second square, far from the first.
    const d = distanceToShapeKm({ lat: 18.15, lng: -65.39 }, TWO_PARTS);
    expect(d).toBeLessThan(1.5);
  });

  it('feeds the existing curve so inside scores 5000', () => {
    expect(scoreForDistance(distanceToShapeKm({ lat: 18.05, lng: -66.45 }, SQUARE))).toBe(5000);
  });
});

describe('nearestPointOnShape', () => {
  it('projects onto the closest edge', () => {
    const { point, distanceKm } = nearestPointOnShape({ lat: 17.95, lng: -66.45 }, SQUARE);
    expect(point.lat).toBeCloseTo(18.0, 5);
    expect(point.lng).toBeCloseTo(-66.45, 5);
    expect(distanceKm).toBeCloseTo(5.57, 1);
  });

  it('clamps to a vertex when beyond the segment end', () => {
    const { point } = nearestPointOnShape({ lat: 17.9, lng: -66.6 }, SQUARE);
    expect(point.lat).toBeCloseTo(18.0, 5);
    expect(point.lng).toBeCloseTo(-66.5, 5);
  });
});
