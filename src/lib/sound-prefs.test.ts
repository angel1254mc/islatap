import { describe, expect, it } from 'vitest';
import { MUTED_KEY, loadMuted, saveMuted } from './sound-prefs';
import type { StorageLike } from './history';

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('loadMuted', () => {
  it('defaults to unmuted for a player who has never touched the toggle', () => {
    expect(loadMuted(fakeStorage())).toBe(false);
  });

  it('reads a stored mute', () => {
    expect(loadMuted(fakeStorage({ [MUTED_KEY]: 'true' }))).toBe(true);
  });

  it('treats anything but "true" as unmuted', () => {
    expect(loadMuted(fakeStorage({ [MUTED_KEY]: 'yes please' }))).toBe(false);
  });

  it('survives a storage that throws', () => {
    const hostile: StorageLike = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {},
    };
    expect(loadMuted(hostile)).toBe(false);
  });
});

describe('saveMuted', () => {
  it('round-trips through loadMuted', () => {
    const storage = fakeStorage();
    saveMuted(storage, true);
    expect(loadMuted(storage)).toBe(true);
    saveMuted(storage, false);
    expect(loadMuted(storage)).toBe(false);
  });

  it('survives a storage that throws', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveMuted(hostile, true)).not.toThrow();
  });
});
