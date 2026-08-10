import { describe, expect, it } from 'vitest';
import type { Category } from '../../src/data/types';
import { addDays } from './date';
import {
  BAG_CANDIDATES_SQL,
  ROUNDS_PER_DAY,
  dailyMix,
  drawRounds,
  isLandmarkDay,
  type BagCandidate,
  type DrawnRound,
} from './puzzle';

interface PoolEntry {
  id: number;
  category: Category;
}

interface HistoryRow {
  gameDate: string;
  ordinal: number;
  locationId: number;
  cycleNo: number;
}

/**
 * In-memory stand-in for the two tables drawRounds reasons about.
 *
 * `candidates()` is a hand-written mirror of BAG_CANDIDATES_SQL:
 *   last_cycle_no = COALESCE(MAX(pr.cycle_no), 0)  over ALL puzzle_round rows
 *   used_on_date  = BOOL_OR(pr.game_date = $1)
 * Note what the MAX is deliberately *not* filtered by: game_date. Rows the
 * top-up job has already written for future days count as used, exactly like
 * past ones. That is the single most important property of the whole design —
 * filter the used-set to `game_date <= today` and the 30-day buffer gets
 * re-drawn every night and the cycle guarantee evaporates.
 *
 * Indexed with Maps rather than array scans because the year-long simulation
 * below runs this 365 times over a 1088-row pool.
 */
class FakeStore {
  readonly rows: HistoryRow[] = [];
  private readonly lastCycle = new Map<number, number>();
  private readonly byDate = new Map<string, Set<number>>();

  insert(gameDate: string, drawn: readonly DrawnRound[]): void {
    for (const round of drawn) {
      this.rows.push({ gameDate, ...round });
      this.lastCycle.set(
        round.locationId,
        Math.max(this.lastCycle.get(round.locationId) ?? 0, round.cycleNo),
      );
      const onDate = this.byDate.get(gameDate) ?? new Set<number>();
      onDate.add(round.locationId);
      this.byDate.set(gameDate, onDate);
    }
  }

  candidates(pool: readonly PoolEntry[], gameDate: string): BagCandidate[] {
    const onDate = this.byDate.get(gameDate) ?? new Set<number>();
    return pool.map((entry) => ({
      id: entry.id,
      category: entry.category,
      lastCycleNo: this.lastCycle.get(entry.id) ?? 0,
      usedOnDate: onDate.has(entry.id),
    }));
  }
}

function makePool(municipio: number, landmark: number, barrio: number): PoolEntry[] {
  const pool: PoolEntry[] = [];
  let id = 1;
  for (let i = 0; i < municipio; i++) pool.push({ id: id++, category: 'municipio' });
  for (let i = 0; i < landmark; i++) pool.push({ id: id++, category: 'landmark' });
  for (let i = 0; i < barrio; i++) pool.push({ id: id++, category: 'barrio' });
  return pool;
}

const categoryOf = (pool: readonly PoolEntry[], id: number): Category => {
  const entry = pool.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`id ${id} is not in the pool`);
  return entry.category;
};

describe('dailyMix', () => {
  it('always adds up to a full puzzle', () => {
    for (let offset = 0; offset < 12; offset++) {
      const date = addDays('2026-08-05', offset);
      const mix = dailyMix(date);
      expect(mix.municipio + mix.landmark + mix.barrio).toBe(ROUNDS_PER_DAY);
      expect(mix.municipio).toBe(1);
    }
  });

  it('spends a landmark every third day and nothing else', () => {
    // 26 landmarks at 1/day would last 26 days; at 1 every 3rd day they last 78,
    // which is exactly how long the 78 municipios last at 1/day.
    expect(isLandmarkDay('2026-08-05')).toBe(true);
    expect(isLandmarkDay('2026-08-06')).toBe(false);
    expect(isLandmarkDay('2026-08-07')).toBe(false);
    expect(isLandmarkDay('2026-08-08')).toBe(true);
    expect(dailyMix('2026-08-05')).toEqual({ municipio: 1, landmark: 1, barrio: 3 });
    expect(dailyMix('2026-08-06')).toEqual({ municipio: 1, landmark: 0, barrio: 4 });
  });
});

describe('drawRounds', () => {
  it('is deterministic for a given date and bag state', () => {
    const pool = makePool(5, 5, 20);
    const store = new FakeStore();
    const candidates = store.candidates(pool, '2026-08-05');
    expect(drawRounds(candidates, '2026-08-05')).toEqual(drawRounds(candidates, '2026-08-05'));
    // ...and different dates must not produce the same puzzle.
    expect(drawRounds(candidates, '2026-08-05')).not.toEqual(
      drawRounds(store.candidates(pool, '2026-08-08'), '2026-08-08'),
    );
  });

  it('numbers the rounds 1..N with no gaps', () => {
    const pool = makePool(5, 5, 20);
    const drawn = drawRounds(new FakeStore().candidates(pool, '2026-08-05'), '2026-08-05');
    expect(drawn.map((round) => round.ordinal).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never draws the same location twice on one date', () => {
    // The rollover boundary is the only way a duplicate can happen: the cycle
    // N+1 bag is "everything cycle N already spent", which includes the rows
    // this very puzzle just drew. Five barrios, three already spent at cycle 1,
    // and a day that needs four of them, forces exactly that path.
    const pool = makePool(1, 1, 5);
    const store = new FakeStore();
    store.insert('2026-07-01', [
      { ordinal: 1, locationId: 3, cycleNo: 1 }, // barrio ids are 3..7 in this pool
      { ordinal: 2, locationId: 4, cycleNo: 1 },
      { ordinal: 3, locationId: 5, cycleNo: 1 },
    ]);
    const drawn = drawRounds(store.candidates(pool, '2026-08-06'), '2026-08-06');
    const ids = drawn.map((round) => round.locationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it('finishes the old cycle first, then tops up from the next one', () => {
    const pool = makePool(1, 1, 5);
    const store = new FakeStore();
    // Barrios 3, 4, 5 are spent at cycle 1; the bag holds only 6 and 7.
    store.insert('2026-07-01', [
      { ordinal: 1, locationId: 3, cycleNo: 1 },
      { ordinal: 2, locationId: 4, cycleNo: 1 },
      { ordinal: 3, locationId: 5, cycleNo: 1 },
    ]);
    // 2026-08-06 is not a landmark day, so it needs four barrios against a
    // two-entry bag.
    const drawn = drawRounds(store.candidates(pool, '2026-08-06'), '2026-08-06');
    const barrios = drawn.filter((round) => categoryOf(pool, round.locationId) === 'barrio');
    expect(barrios).toHaveLength(4);

    const atCycle1 = barrios.filter((round) => round.cycleNo === 1).map((round) => round.locationId);
    const atCycle2 = barrios.filter((round) => round.cycleNo === 2).map((round) => round.locationId);
    expect(atCycle1.sort()).toEqual([6, 7]);       // the whole remaining bag, drained
    expect(atCycle2).toHaveLength(2);              // topped up from the fresh cycle
    expect(atCycle2.every((id) => [3, 4, 5].includes(id))).toBe(true);
    expect(new Set([...atCycle1, ...atCycle2]).size).toBe(4);
  });

  it('treats rows scheduled for FUTURE dates as already used', () => {
    // The top-up job runs 30 days ahead, so on any given night most of the bag
    // is spoken for by dates that have not happened yet. Four municipios, three
    // of them booked for next week, means today has exactly one legal choice.
    const pool = makePool(4, 1, 8);
    const store = new FakeStore();
    store.insert('2026-08-20', [{ ordinal: 1, locationId: 1, cycleNo: 1 }]);
    store.insert('2026-08-21', [{ ordinal: 1, locationId: 2, cycleNo: 1 }]);
    store.insert('2026-08-22', [{ ordinal: 1, locationId: 3, cycleNo: 1 }]);

    const drawn = drawRounds(store.candidates(pool, '2026-08-06'), '2026-08-06');
    const municipios = drawn.filter((round) => categoryOf(pool, round.locationId) === 'municipio');
    expect(municipios).toHaveLength(1);
    expect(municipios[0].locationId).toBe(4);
    expect(municipios[0].cycleNo).toBe(1);
  });

  it('lets a location added mid-cycle join the current bag immediately', () => {
    const pool = makePool(2, 1, 8);
    const store = new FakeStore();
    store.insert('2026-08-01', [{ ordinal: 1, locationId: 1, cycleNo: 1 }]);
    // Municipio 2 has never been drawn (last_cycle_no 0 < current cycle 1), so
    // it is in the bag rather than having to wait for the next rollover.
    const drawn = drawRounds(store.candidates(pool, '2026-08-06'), '2026-08-06');
    const municipios = drawn.filter((round) => categoryOf(pool, round.locationId) === 'municipio');
    expect(municipios[0].locationId).toBe(2);
  });

  it('throws rather than shipping a short puzzle when a category cannot fill its slots', () => {
    // Three barrios can never satisfy a four-barrio day, even across a
    // rollover. Silently returning four rounds would break UNIQUE(game_date,
    // ordinal) expectations downstream and hand players an inconsistent game.
    const pool = makePool(1, 1, 3);
    expect(() => drawRounds(new FakeStore().candidates(pool, '2026-08-06'), '2026-08-06')).toThrow(
      /barrio/,
    );
  });
});

describe('bag exhaustion over a simulated year', () => {
  // The bug this replaces: pickGameRounds() burned all three categories at
  // ~1.67 draws/day, which empties the 26-landmark pool in ~16 days and then
  // repeats landmarks forever. A year of the real pool is the proof.
  const POOL = makePool(78, 26, 984);
  const START = '2026-01-01';
  const DAYS = 365;

  const store = new FakeStore();
  for (let offset = 0; offset < DAYS; offset++) {
    const gameDate = addDays(START, offset);
    store.insert(gameDate, drawRounds(store.candidates(POOL, gameDate), gameDate));
  }

  const drawsPerLocation = new Map<number, number>();
  for (const row of store.rows) {
    drawsPerLocation.set(row.locationId, (drawsPerLocation.get(row.locationId) ?? 0) + 1);
  }
  const countsFor = (category: Category): number[] =>
    POOL.filter((entry) => entry.category === category).map(
      (entry) => drawsPerLocation.get(entry.id) ?? 0,
    );

  it('produces a complete, duplicate-free puzzle every single day', () => {
    expect(store.rows).toHaveLength(DAYS * ROUNDS_PER_DAY);
    for (let offset = 0; offset < DAYS; offset++) {
      const gameDate = addDays(START, offset);
      const day = store.rows.filter((row) => row.gameDate === gameDate);
      expect(day).toHaveLength(ROUNDS_PER_DAY);
      expect(new Set(day.map((row) => row.locationId)).size).toBe(ROUNDS_PER_DAY);
      expect(day.map((row) => row.ordinal).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('spends landmarks at one per landmark-day and never exhausts them', () => {
    const landmarkDays = Array.from({ length: DAYS }, (_, offset) =>
      addDays(START, offset),
    ).filter(isLandmarkDay);
    expect(landmarkDays).toHaveLength(122);

    const counts = countsFor('landmark');
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(122);
    // 122 draws over 26 landmarks: a fair bag gives everyone 4 or 5 turns.
    // The old generator would instead have replayed a handful of favourites.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(Math.min(...counts)).toBe(4);
  });

  it('keeps every category within one draw of perfectly even usage', () => {
    for (const category of ['municipio', 'landmark', 'barrio'] as const) {
      const counts = countsFor(category);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    expect(countsFor('municipio').reduce((sum, n) => sum + n, 0)).toBe(365);
    expect(countsFor('barrio').reduce((sum, n) => sum + n, 0)).toBe(1338);
  });

  it('never repeats a location inside one cycle', () => {
    const seen = new Map<string, Set<number>>();
    for (const row of store.rows) {
      const key = `${categoryOf(POOL, row.locationId)}:${row.cycleNo}`;
      const bucket = seen.get(key) ?? new Set<number>();
      expect(bucket.has(row.locationId)).toBe(false);
      bucket.add(row.locationId);
      seen.set(key, bucket);
    }
  });
});

describe('BAG_CANDIDATES_SQL', () => {
  it('does not filter the used-set by date', () => {
    // A guard, not a formality: adding `AND pr.game_date <= CURRENT_DATE` here
    // is the single easiest way to break the whole scheme, because it looks
    // like an optimisation and the symptom (buffered days re-drawn) only shows
    // up 30 days later.
    expect(BAG_CANDIDATES_SQL).not.toMatch(/CURRENT_DATE/i);
    expect(BAG_CANDIDATES_SQL).not.toMatch(/game_date\s*<=/i);
    expect(BAG_CANDIDATES_SQL).toMatch(/MAX\(pr\.cycle_no\)/i);
    // Row order feeds a seeded RNG, so it must be pinned or the draw stops
    // being reproducible.
    expect(BAG_CANDIDATES_SQL).toMatch(/ORDER BY l\.id/i);
  });
});
