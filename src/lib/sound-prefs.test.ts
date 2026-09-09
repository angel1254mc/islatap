import { describe, expect, it } from 'vitest';
import { MUTED_KEY, VOLUME_KEY, loadMuted, loadVolume, saveMuted, saveVolume } from './sound-prefs';
import { DEFAULT_VOLUME } from './sound';
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

describe('loadVolume', () => {
  it('starts a new player at the midpoint', () => {
    expect(loadVolume(fakeStorage())).toBe(DEFAULT_VOLUME);
  });

  it('reads a stored setting', () => {
    expect(loadVolume(fakeStorage({ [VOLUME_KEY]: '0.8' }))).toBe(0.8);
  });

  it('clamps a hand-edited value into range', () => {
    expect(loadVolume(fakeStorage({ [VOLUME_KEY]: '42' }))).toBe(1);
    expect(loadVolume(fakeStorage({ [VOLUME_KEY]: '-3' }))).toBe(0);
  });

  it('falls back to the default on a value that is not a number', () => {
    expect(loadVolume(fakeStorage({ [VOLUME_KEY]: 'loud' }))).toBe(DEFAULT_VOLUME);
  });

  it('survives a storage that throws', () => {
    const hostile: StorageLike = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {},
    };
    expect(loadVolume(hostile)).toBe(DEFAULT_VOLUME);
  });
});

describe('saveVolume', () => {
  it('round-trips through loadVolume', () => {
    const storage = fakeStorage();
    saveVolume(storage, 0.35);
    expect(loadVolume(storage)).toBe(0.35);
  });

  it('stores silence as silence, not as the default', () => {
    const storage = fakeStorage();
    saveVolume(storage, 0);
    expect(loadVolume(storage)).toBe(0);
  });

  it('survives a storage that throws', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveVolume(hostile, 0.5)).not.toThrow();
  });
});
