import { describe, expect, it } from 'vitest';
import {
  EMPTY_HISTORY,
  HISTORY_KEY,
  LEGACY_BEST_KEY,
  bestTotal,
  entryFor,
  loadHistory,
  nextDate,
  previousDate,
  recordDay,
  streakEndingAt,
  type DayEntry,
  type GameHistory,
  type StorageLike,
} from './history';

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

const ENTRY = (total: number): DayEntry => ({
  total,
  rows: [{ key: 'r1', name: 'Hato Rey', municipio: 'San Juan', points: total, distanceKm: 1, inside: false }],
  playedAt: '2026-08-05T12:00:00.000Z',
});

function withDays(...dates: string[]): GameHistory {
  return {
    version: 1,
    days: Object.fromEntries(dates.map((d, i) => [d, ENTRY(1000 + i)])),
    legacyBest: null,
  };
}

describe('date arithmetic', () => {
  it('walks back a day', () => {
    expect(previousDate('2026-08-05')).toBe('2026-08-04');
  });

  it('crosses a month boundary', () => {
    expect(previousDate('2026-08-01')).toBe('2026-07-31');
    expect(nextDate('2026-07-31')).toBe('2026-08-01');
  });

  it('crosses a year boundary', () => {
    expect(previousDate('2026-01-01')).toBe('2025-12-31');
    expect(nextDate('2025-12-31')).toBe('2026-01-01');
  });

  it('handles a leap day', () => {
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
    expect(previousDate('2028-03-01')).toBe('2028-02-29');
  });
});

describe('loadHistory', () => {
  it('returns an empty history when nothing is stored', () => {
    expect(loadHistory(fakeStorage())).toEqual(EMPTY_HISTORY);
  });

  it('returns an empty history when storage is unavailable', () => {
    expect(loadHistory(null)).toEqual(EMPTY_HISTORY);
  });

  it('reads back what recordDay wrote', () => {
    const storage = fakeStorage();
    recordDay(EMPTY_HISTORY, '2026-08-05', ENTRY(4200), storage);
    const reloaded = loadHistory(storage);
    expect(reloaded.days['2026-08-05'].total).toBe(4200);
    expect(reloaded.days['2026-08-05'].rows).toHaveLength(1);
  });

  it('migrates the pre-history best score instead of dropping it', () => {
    // Real players have this key today. Silently discarding it visibly
    // regresses their Best score chip, and there is no date attached to it so
    // it cannot become a day entry.
    const storage = fakeStorage({ [LEGACY_BEST_KEY]: '18432' });
    expect(loadHistory(storage).legacyBest).toBe(18432);
  });

  it('ignores a non-numeric legacy value', () => {
    expect(loadHistory(fakeStorage({ [LEGACY_BEST_KEY]: 'banana' })).legacyBest).toBeNull();
  });

  it('recovers from corrupted JSON rather than throwing', () => {
    // This is read during a render, and the app has no error boundary, so a
    // throw here is a white screen.
    expect(loadHistory(fakeStorage({ [HISTORY_KEY]: '{not json' }))).toEqual(EMPTY_HISTORY);
  });

  it('recovers from a structurally wrong payload', () => {
    expect(loadHistory(fakeStorage({ [HISTORY_KEY]: '[1,2,3]' }))).toEqual(EMPTY_HISTORY);
    expect(loadHistory(fakeStorage({ [HISTORY_KEY]: '{"version":1,"days":7}' }))).toEqual(EMPTY_HISTORY);
  });
});

describe('recordDay', () => {
  it('never overwrites a date already played', () => {
    // A reload mid-day must restore the finished game, not let it be replayed
    // for a better score.
    const storage = fakeStorage();
    const first = recordDay(EMPTY_HISTORY, '2026-08-05', ENTRY(1000), storage);
    const second = recordDay(first, '2026-08-05', ENTRY(9999), storage);
    expect(second.days['2026-08-05'].total).toBe(1000);
    expect(loadHistory(storage).days['2026-08-05'].total).toBe(1000);
  });

  it('survives a storage that refuses to write', () => {
    // Private browsing and quota-exceeded both throw from setItem. The game
    // must finish anyway; only persistence is lost.
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const next = recordDay(EMPTY_HISTORY, '2026-08-05', ENTRY(1000), hostile);
    expect(next.days['2026-08-05'].total).toBe(1000);
  });
});

describe('streakEndingAt', () => {
  it('is zero when the given day has not been played', () => {
    expect(streakEndingAt(withDays('2026-08-03', '2026-08-04'), '2026-08-05')).toBe(0);
  });

  it('counts consecutive days ending at the given one', () => {
    expect(streakEndingAt(withDays('2026-08-03', '2026-08-04', '2026-08-05'), '2026-08-05')).toBe(3);
  });

  it('stops at the first gap', () => {
    expect(
      streakEndingAt(withDays('2026-08-01', '2026-08-04', '2026-08-05'), '2026-08-05'),
    ).toBe(2);
  });

  it('counts across a month boundary', () => {
    expect(streakEndingAt(withDays('2026-07-31', '2026-08-01'), '2026-08-01')).toBe(2);
  });
});

describe('bestTotal', () => {
  it('is null on an empty history', () => {
    expect(bestTotal(EMPTY_HISTORY)).toBeNull();
  });

  it('is the highest daily total', () => {
    expect(bestTotal(withDays('2026-08-03', '2026-08-04', '2026-08-05'))).toBe(1002);
  });

  it('still honours a migrated legacy best that beats every recorded day', () => {
    const history: GameHistory = { ...withDays('2026-08-05'), legacyBest: 24000 };
    expect(bestTotal(history)).toBe(24000);
  });
});

describe('entryFor', () => {
  it('returns the stored entry or null', () => {
    const history = withDays('2026-08-05');
    expect(entryFor(history, '2026-08-05')?.total).toBe(1000);
    expect(entryFor(history, '2026-08-06')).toBeNull();
  });
});
