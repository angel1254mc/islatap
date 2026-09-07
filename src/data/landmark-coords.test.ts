import { describe, expect, it } from 'vitest';
import { haversineKm } from '../lib/scoring';
import { CURATED_LOCATIONS } from './curated';

const LANDMARKS = CURATED_LOCATIONS.filter((l) => l.category === 'landmark');

describe('curated landmark coordinates', () => {
  it('has an independently sourced ref for every landmark', () => {
    const unreferenced = LANDMARKS.filter((l) => !l.ref).map((l) => `${l.id} ${l.name}`);
    expect(unreferenced).toEqual([]);
  });

  it('cites a resolvable source for every ref', () => {
    // gnis:<feature_id> or osm:<type>/<id>. A free-text source is how "verified"
    // came to mean nothing the first time round.
    const malformed = LANDMARKS.filter(
      (l) => l.ref && !/^(gnis:\d+|osm:(node|way|relation)\/\d+)$/.test(l.ref.source),
    ).map((l) => `${l.id} ${l.name}: ${l.ref!.source}`);
    expect(malformed).toEqual([]);
  });

  // THE regression test. All six coordinates fixed in this branch violated
  // exactly this: the answer sat outside its own acceptance circle, so the
  // round could not be won by tapping the real place.
  it('keeps every acceptance circle over the real landmark', () => {
    const missed: string[] = [];

    for (const landmark of LANDMARKS) {
      if (landmark.radiusKm == null || !landmark.ref) continue; // geoid rows score by shape
      const km = haversineKm(landmark, landmark.ref);
      if (km > landmark.radiusKm) {
        missed.push(
          `${landmark.name}: ${km.toFixed(3)} km from ${landmark.ref.source}, ` +
            `outside its own radiusKm ${landmark.radiusKm}`,
        );
      }
    }

    expect(missed).toEqual([]);
  });

  // Shape-scored landmarks (the five islands) have no radius to check, but a
  // grossly wrong point would still send the reveal camera to open ocean.
  it('keeps shape-scored landmarks near their ref', () => {
    const strays: string[] = [];

    for (const landmark of LANDMARKS) {
      if (landmark.radiusKm != null || !landmark.ref) continue;
      const km = haversineKm(landmark, landmark.ref);
      // Generous: these are whole-island points, where a gazetteer point and a
      // polygon centroid legitimately disagree by a couple of km on Vieques.
      if (km > 5) strays.push(`${landmark.name}: ${km.toFixed(3)} km from ${landmark.ref.source}`);
    }

    expect(strays).toEqual([]);
  });

  it('puts a ref only where one means something', () => {
    // Municipios come from GeoNames wholesale and barrios are approximate by
    // nature; a ref on those would imply a precision that is not there.
    const misplaced = CURATED_LOCATIONS.filter((l) => l.category !== 'landmark' && l.ref).map(
      (l) => `${l.id} ${l.name} (${l.category})`,
    );
    expect(misplaced).toEqual([]);
  });
});
