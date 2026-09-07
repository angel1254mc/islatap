import { describe, expect, it } from 'vitest';
import { haversineKm } from '../lib/scoring';
import { CURATED_LOCATIONS } from './curated';
import { LANDMARK_REFERENCES } from './landmark-references';

const LANDMARKS = CURATED_LOCATIONS.filter((l) => l.category === 'landmark');
const BY_ID = new Map(LANDMARK_REFERENCES.map((r) => [r.id, r]));

describe('curated landmark coordinates', () => {
  it('has an independently sourced reference for every landmark', () => {
    const unreferenced = LANDMARKS.filter((l) => !BY_ID.has(l.id)).map((l) => `${l.id} ${l.name}`);
    expect(unreferenced).toEqual([]);
  });

  it('has no reference for a landmark that no longer exists', () => {
    const ids = new Set(LANDMARKS.map((l) => l.id));
    const orphans = LANDMARK_REFERENCES.filter((r) => !ids.has(r.id)).map((r) => `${r.id} ${r.name}`);
    expect(orphans).toEqual([]);
  });

  it('pairs each reference with the landmark it was resolved for', () => {
    // Ids are reused as-is when a row is edited, so a rename that swaps two
    // rows would silently repoint a reference. Cheap guard against that.
    const mismatched = LANDMARKS.filter((l) => BY_ID.get(l.id)!.name !== l.name).map(
      (l) => `${l.id}: curated "${l.name}" vs reference "${BY_ID.get(l.id)!.name}"`,
    );
    expect(mismatched).toEqual([]);
  });

  // THE regression test. All six coordinates fixed in this branch violated
  // exactly this: the answer sat outside its own acceptance circle, so the
  // round could not be won by tapping the real place.
  it('keeps every acceptance circle over the real landmark', () => {
    const missed: string[] = [];

    for (const landmark of LANDMARKS) {
      if (landmark.radiusKm == null) continue; // geoid rows score by shape
      const ref = BY_ID.get(landmark.id)!;
      const km = haversineKm(landmark, ref);
      if (km > landmark.radiusKm) {
        missed.push(
          `${landmark.name}: ${km.toFixed(3)} km from ${ref.source}, ` +
            `outside its own radiusKm ${landmark.radiusKm}`,
        );
      }
    }

    expect(missed).toEqual([]);
  });

  // Shape-scored landmarks (the five islands) have no radius to check, but a
  // grossly wrong point would still send the reveal camera to open ocean.
  it('keeps shape-scored landmarks near their reference', () => {
    const strays: string[] = [];

    for (const landmark of LANDMARKS) {
      if (landmark.radiusKm != null) continue;
      const ref = BY_ID.get(landmark.id)!;
      const km = haversineKm(landmark, ref);
      // Generous: these are whole-island points, where a gazetteer point and a
      // polygon centroid legitimately disagree by a couple of km on Vieques.
      if (km > 5) strays.push(`${landmark.name}: ${km.toFixed(3)} km from ${ref.source}`);
    }

    expect(strays).toEqual([]);
  });
});
