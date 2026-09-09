import type { StorageLike } from './history';
import { DEFAULT_VOLUME } from './sound';

/**
 * Whether the player has muted the tap sounds.
 *
 * Versioned like HISTORY_KEY so a future preferences blob can supersede a bare
 * boolean without reading one browser's leftovers as the other's format.
 */
export const MUTED_KEY = 'islatap:muted:v1';

/**
 * Read the mute preference, defaulting to unmuted.
 *
 * Both accessors are wrapped because localStorage is not merely absent in some
 * browsers, it *throws*: Safari in private mode and Chrome with third-party
 * site data blocked raise on the property access itself. A player with cookies
 * locked down should lose the preference, not the game.
 */
export function loadMuted(storage: StorageLike): boolean {
  try {
    return storage.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveMuted(storage: StorageLike, muted: boolean): void {
  try {
    storage.setItem(MUTED_KEY, String(muted));
  } catch {
    // Preference is a nicety; a full or locked-down quota must not break a tap.
  }
}

/** How loud the tap sounds play, 0..1. Versioned for the same reason. */
export const VOLUME_KEY = 'islatap:volume:v1';

/** Read the volume, defaulting to the midpoint. */
export function loadVolume(storage: StorageLike): number {
  let raw: string | null;
  try {
    raw = storage.getItem(VOLUME_KEY);
  } catch {
    return DEFAULT_VOLUME;
  }
  if (raw === null) return DEFAULT_VOLUME;

  // Number() rather than parseFloat(): parseFloat('0.5rem') is 0.5, and a value
  // that arrived malformed should fall back, not be half-believed.
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, parsed));
}

export function saveVolume(storage: StorageLike, volume: number): void {
  try {
    storage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // As above: a preference is never worth a crash.
  }
}
