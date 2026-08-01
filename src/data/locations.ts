// Merges the two halves of the dataset. Import from here, not from the parts.
//
//   curated.ts          hand-vetted, authoritative — edit freely
//   tiger.generated.ts  Census TIGER/Line 2022 — regenerate, never hand-edit
//
// Curated rows come first so that any downstream first-match-wins lookup prefers them.
import { CURATED_LOCATIONS } from './curated';
import { TIGER_LOCATIONS } from './tiger.generated';
import type { GameLocation } from './types';

export type { Category, Difficulty, GameLocation, Source, Subtype } from './types';
export { displayName } from './types';

export const LOCATIONS: GameLocation[] = [...CURATED_LOCATIONS, ...TIGER_LOCATIONS];
