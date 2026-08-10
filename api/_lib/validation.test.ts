import { describe, expect, it } from 'vitest';
import { PR_BOUNDS, guessBodySchema } from './validation';

const ROUND_ID = '11111111-1111-4111-8111-111111111111';
const SAN_JUAN = { roundId: ROUND_ID, lat: 18.46633, lng: -66.10572 };

describe('guessBodySchema', () => {
  it('accepts a tap anywhere the map can actually produce one', () => {
    expect(guessBodySchema.safeParse(SAN_JUAN).success).toBe(true);
    // The four corners of the map's own maxBounds.
    for (const lat of [PR_BOUNDS.minLat, PR_BOUNDS.maxLat]) {
      for (const lng of [PR_BOUNDS.minLng, PR_BOUNDS.maxLng]) {
        expect(guessBodySchema.safeParse({ roundId: ROUND_ID, lat, lng }).success).toBe(true);
      }
    }
  });

  it('rejects null coordinates', () => {
    // This is the exact shape a NaN takes after a round trip: JSON.stringify
    // renders NaN as null. Unvalidated, that null coerces its way into
    // haversineKm and comes back out as {"points": null} with a 200.
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: null }).success).toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lng: null }).success).toBe(false);
  });

  it('rejects coordinates outside Puerto Rico', () => {
    // lat 999 currently scores a clean 0 and looks like a bad guess rather than
    // a bug, which is why the bound has to be the island and not the globe.
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: 999 }).success).toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: 91 }).success).toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lng: 0 }).success).toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: 17.79 }).success).toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: 18.61 }).success).toBe(false);
  });

  it('rejects swapped lat/lng', () => {
    // Both halves fail the bounds independently, so the mistake surfaces as a
    // 400 instead of as an 11,600 km "guess".
    expect(guessBodySchema.safeParse({ roundId: ROUND_ID, lat: -66.10572, lng: 18.46633 }).success)
      .toBe(false);
  });

  it('rejects non-finite numbers', () => {
    // JSON has no NaN or Infinity literal, but JSON.parse('{"lat":1e999}')
    // yields Infinity, and Infinity survives Math.max/Math.min untouched.
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: Number.POSITIVE_INFINITY }).success)
      .toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: Number.NaN }).success).toBe(false);
  });

  it('rejects strings that look like numbers', () => {
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, lat: '18.46633' }).success).toBe(false);
  });

  it('rejects a missing or malformed roundId', () => {
    expect(guessBodySchema.safeParse({ lat: 18.46633, lng: -66.10572 }).success).toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, roundId: 'not-a-uuid' }).success).toBe(false);
    expect(guessBodySchema.safeParse({ ...SAN_JUAN, roundId: 42 }).success).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(guessBodySchema.safeParse(null).success).toBe(false);
    expect(guessBodySchema.safeParse('hello').success).toBe(false);
    expect(guessBodySchema.safeParse([SAN_JUAN]).success).toBe(false);
  });
});
