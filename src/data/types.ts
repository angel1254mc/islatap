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
  /** Census GEOID, present only on TIGER-derived rows. */
  geoid?: string;
  lat: number;
  lng: number;
}

/** The prompt string shown to the player and used in share text. */
export function displayName(location: GameLocation): string {
  return location.municipio ? `${location.name}, ${location.municipio}` : location.name;
}
