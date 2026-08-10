/** Broad game bucket. Drives round variety and the coloured tag in the HUD. */
export type Category = 'municipio' | 'landmark' | 'barrio';

/**
 * What the place actually is. `barrio` covers both true Census barrios and the
 * comunidad CDPs that share the bucket, so this is what tells them apart.
 */
export type Subtype =
  | 'municipio'
  | 'landmark'
  | 'barrio'
  | 'barrio-pueblo'
  | 'comunidad';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Provenance, so a coordinate's authority is always legible from the data. */
export type Source = 'geonames' | 'curated' | 'tiger-cousub' | 'tiger-place';

export interface GameLocation {
  id: number;
  name: string;
  /**
   * Municipio this sits in, or null for municipios and island-wide landmarks.
   * Required for disambiguation: 344 of the 901 Census barrios share a name with
   * another barrio (Quebrada Arenas exists 6 times), so the bare name is not a
   * answerable prompt on its own.
   */
  municipio: string | null;
  category: Category;
  subtype: Subtype;
  difficulty: Difficulty;
  source: Source;
  /**
   * Key into shapes-pr.json. Usually a Census GEOID; curated umbrella entries
   * that span several Census units use a synthetic key (e.g. '72127-hato-rey')
   * that the generator fills with a merged shape.
   */
  geoid?: string;
  /**
   * Acceptance radius for locations with no boundary shape: a guess within
   * this distance of the point scores full marks, and decay starts at the
   * circle's edge. Defaults to DEFAULT_ACCEPT_RADIUS_KM (50 m); the shapeless
   * colloquial barrios (Isla Verde, La Perla, Levittown, Piñones) widen it
   * because they are areas, not points.
   */
  radiusKm?: number;
  lat: number;
  lng: number;
}

/**
 * "Name, Municipio" when qualified, bare name otherwise.
 *
 * Typed structurally rather than as GameLocation so a round answer straight
 * off /api/guess — which carries only lat, lng, name and municipio — can be
 * rendered by the same helper. GameLocation still satisfies it, and so does
 * a ResultRow, which is what lets Results.tsx import this from data/types
 * instead of from data/locations and stay clear of the coordinate table.
 */
export function displayName(location: { name: string; municipio: string | null }): string {
  return location.municipio ? `${location.name}, ${location.municipio}` : location.name;
}
