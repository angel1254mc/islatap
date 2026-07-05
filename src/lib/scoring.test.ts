import { describe, expect, it } from 'vitest';
import {
  DISTANCE_DECAY_KM,
  MAX_ROUND_POINTS,
  formatDistance,
  haversineKm,
  scoreForDistance,
} from './scoring';

const SAN_JUAN = { lat: 18.46633, lng: -66.10572 };
const PONCE = { lat: 18.01031, lng: -66.62398 };

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(SAN_JUAN, SAN_JUAN)).toBe(0);
  });

  it('measures one degree of longitude at the equator as ~111.19 km', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
  });

  it('puts San Juan roughly 75 km from Ponce', () => {
    const d = haversineKm(SAN_JUAN, PONCE);
    expect(d).toBeGreaterThan(65);
    expect(d).toBeLessThan(85);
  });

  it('is symmetric', () => {
    expect(haversineKm(SAN_JUAN, PONCE)).toBeCloseTo(haversineKm(PONCE, SAN_JUAN), 10);
  });
});

describe('scoreForDistance', () => {
  it('awards the maximum for a perfect tap', () => {
    expect(scoreForDistance(0)).toBe(MAX_ROUND_POINTS);
  });

  it('awards round(5000/e) points at the decay distance', () => {
    expect(scoreForDistance(DISTANCE_DECAY_KM)).toBe(Math.round(MAX_ROUND_POINTS / Math.E));
  });

  it('bottoms out at 0 for far-away taps', () => {
    expect(scoreForDistance(200)).toBe(0);
  });

  it('decreases monotonically with distance', () => {
    const distances = [0, 0.5, 1, 2, 5, 10, 20, 50, 100];
    const points = distances.map(scoreForDistance);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeLessThanOrEqual(points[i - 1]);
    }
  });

  it('never leaves the [0, MAX_ROUND_POINTS] range', () => {
    for (const km of [0, 0.001, 3, 42, 1000, 100000]) {
      const p = scoreForDistance(km);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(MAX_ROUND_POINTS);
    }
  });
});

describe('formatDistance', () => {
  it('uses meters below one kilometer', () => {
    expect(formatDistance(0.532)).toBe('532 m');
    expect(formatDistance(0.0004)).toBe('0 m');
  });

  it('uses kilometers to one decimal at or above one kilometer', () => {
    expect(formatDistance(1)).toBe('1.0 km');
    expect(formatDistance(12.34)).toBe('12.3 km');
  });
});
