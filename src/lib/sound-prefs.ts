import type { StorageLike } from './history';

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
