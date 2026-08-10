import { describe, expect, it } from 'vitest';
import type { Category } from '../../src/data/types';
import { addDays } from './date';
import type { SqlExecutor, SqlRow } from './db';
import { generateDate, topUpBuffer } from './generate';
import {
  BAG_CANDIDATES_SQL,
  CLAIM_AND_INSERT_ROUNDS_SQL,
  EXISTING_PUZZLE_DATES_SQL,
} from './puzzle';

interface PoolEntry {
  id: number;
  category: Category;
}

interface StoredRound {
  gameDate: string;
  ordinal: number;
  locationId: number;
  cycleNo: number;
}

/**
 * A SqlExecutor backed by JavaScript objects that answers the three statements
 * this module issues, matched by identity against the exported constants. It is
 * a stand-in for Postgres, not a simulation of it — its job is to prove the
 * driver glue (parameter order, row decoding, the sequential loop, the
 * claim-once semantics), while api/_lib/puzzle.test.ts proves the draw itself.
 */
function createFakeDb(pool: readonly PoolEntry[]) {
  const rounds: StoredRound[] = [];
  const claimed = new Set<string>();
  const seen: string[] = [];

  const sql: SqlExecutor = async (text, params = []) => {
    seen.push(text);

    if (text === EXISTING_PUZZLE_DATES_SQL) {
      const start = String(params[0]);
      const days = Number(params[1]);
      const window: string[] = [];
      for (let offset = 0; offset < days; offset++) window.push(addDays(start, offset));
      return window.filter((date) => claimed.has(date)).map((date) => ({ game_date: date }));
    }

    if (text === BAG_CANDIDATES_SQL) {
      const gameDate = String(params[0]);
      return pool.map<SqlRow>((entry) => {
        const mine = rounds.filter((round) => round.locationId === entry.id);
        return {
          id: entry.id,
          category: entry.category,
          last_cycle_no: mine.reduce((max, round) => Math.max(max, round.cycleNo), 0),
          used_on_date: mine.some((round) => round.gameDate === gameDate),
        };
      });
    }

    if (text === CLAIM_AND_INSERT_ROUNDS_SQL) {
      const gameDate = String(params[0]);
      // ON CONFLICT (game_date) DO NOTHING: an already-claimed date writes
      // nothing and returns nothing.
      if (claimed.has(gameDate)) return [];
      claimed.add(gameDate);
      const ordinals = params[1] as number[];
      const locationIds = params[2] as number[];
      const cycleNos = params[3] as number[];
      for (let i = 0; i < ordinals.length; i++) {
        rounds.push({
          gameDate,
          ordinal: ordinals[i],
          locationId: locationIds[i],
          cycleNo: cycleNos[i],
        });
      }
      return ordinals.map((_, index) => ({ id: `round-${gameDate}-${index}` }));
    }

    throw new Error(`Unexpected SQL:\n${text}`);
  };

  return { sql, rounds, claimed, seen };
}

const POOL: PoolEntry[] = [
  { id: 1, category: 'municipio' },
  { id: 2, category: 'municipio' },
  { id: 3, category: 'municipio' },
  { id: 4, category: 'municipio' },
  { id: 5, category: 'landmark' },
  { id: 6, category: 'landmark' },
  { id: 7, category: 'landmark' },
  { id: 8, category: 'landmark' },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: 100 + index,
    category: 'barrio' as Category,
  })),
];

describe('topUpBuffer', () => {
  it('fills every date in the buffer with a complete puzzle', async () => {
    const db = createFakeDb(POOL);
    const result = await topUpBuffer(db.sql, '2026-08-05', 30);

    expect(result.generated).toHaveLength(30);
    expect(result.skipped).toHaveLength(0);
    expect(result.generated[0]).toBe('2026-08-05');
    expect(result.generated[29]).toBe('2026-09-03');
    expect(db.rounds).toHaveLength(150);

    for (const gameDate of result.generated) {
      const day = db.rounds.filter((round) => round.gameDate === gameDate);
      expect(day).toHaveLength(5);
      expect(new Set(day.map((round) => round.locationId)).size).toBe(5);
    }
  });

  it('is idempotent — a second run generates nothing', async () => {
    // The whole point of a buffer: the job runs nightly and 29 of its 30 dates
    // are already there. A re-run must not consume bag entries or duplicate rows.
    const db = createFakeDb(POOL);
    await topUpBuffer(db.sql, '2026-08-05', 30);
    const second = await topUpBuffer(db.sql, '2026-08-05', 30);

    expect(second.generated).toHaveLength(0);
    expect(second.skipped).toHaveLength(30);
    expect(db.rounds).toHaveLength(150);
  });

  it('backfills only the gap after an outage', async () => {
    const db = createFakeDb(POOL);
    await topUpBuffer(db.sql, '2026-08-05', 30);
    // Two weeks later the job runs again: 2026-08-19..2026-09-03 already exist,
    // 2026-09-04..2026-09-17 do not.
    const later = await topUpBuffer(db.sql, '2026-08-19', 30);

    expect(later.skipped).toHaveLength(16);
    expect(later.generated).toHaveLength(14);
    expect(later.generated[0]).toBe('2026-09-04');
    expect(db.rounds).toHaveLength(150 + 70);
  });

  it('draws each date against the rows the previous dates just wrote', async () => {
    // Four municipios and four consecutive days must use all four distinct
    // municipios: if the loop ran concurrently, every date would read the same
    // empty used-set and pick the same one.
    const db = createFakeDb(POOL);
    await topUpBuffer(db.sql, '2026-08-05', 4);
    const municipios = db.rounds
      .filter((round) => round.locationId <= 4)
      .map((round) => round.locationId);
    expect(municipios).toHaveLength(4);
    expect(new Set(municipios).size).toBe(4);
  });
});

describe('generateDate', () => {
  it('treats already-buffered future dates as spent bag entries', async () => {
    // Three of the four municipios are booked for later this month, so today
    // has exactly one legal choice left in the current cycle.
    const db = createFakeDb(POOL);
    await topUpBuffer(db.sql, '2026-08-20', 3);
    const bookedLater = new Set(
      db.rounds.filter((round) => round.locationId <= 4).map((round) => round.locationId),
    );
    expect(bookedLater.size).toBe(3);

    const inserted = await generateDate(db.sql, '2026-08-06');
    expect(inserted).toBe(5);

    const today = db.rounds.filter((round) => round.gameDate === '2026-08-06');
    const municipio = today.find((round) => round.locationId <= 4);
    expect(municipio).toBeDefined();
    expect(bookedLater.has(municipio!.locationId)).toBe(false);
    expect(municipio!.cycleNo).toBe(1);
  });

  it('reports zero inserted rows when the date was already claimed', async () => {
    const db = createFakeDb(POOL);
    expect(await generateDate(db.sql, '2026-08-06')).toBe(5);
    expect(await generateDate(db.sql, '2026-08-06')).toBe(0);
    expect(db.rounds).toHaveLength(5);
  });
});
