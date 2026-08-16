import type { Category } from '../../src/data/types.js';
import { addDays } from './date.js';
import type { SqlExecutor } from './db.js';
import {
  BAG_CANDIDATES_SQL,
  CLAIM_AND_INSERT_ROUNDS_SQL,
  EXISTING_PUZZLE_DATES_SQL,
  drawRounds,
  type BagCandidate,
} from './puzzle.js';

export interface TopUpResult {
  /** Dates this run created a puzzle for. */
  generated: string[];
  /** Dates that already had one (the normal case for 29 of 30 nights). */
  skipped: string[];
}

/**
 * Generate one date's rounds. Returns how many rows were written: 5 on success,
 * 0 if another writer claimed the date first (see CLAIM_AND_INSERT_ROUNDS_SQL —
 * the claim and the insert are one atomic statement, so a lost race writes
 * nothing rather than writing half a puzzle).
 */
export async function generateDate(sql: SqlExecutor, gameDate: string): Promise<number> {
  const rows = await sql(BAG_CANDIDATES_SQL, [gameDate]);
  const candidates: BagCandidate[] = rows.map((row) => ({
    id: Number(row.id),
    category: String(row.category) as Category,
    lastCycleNo: Number(row.last_cycle_no),
    // BOOL_OR can only ever hand back true/false/null; anything else means the
    // query changed shape, and treating it as "used" is the safe reading.
    usedOnDate: row.used_on_date === true,
  }));

  const drawn = drawRounds(candidates, gameDate);

  const inserted = await sql(CLAIM_AND_INSERT_ROUNDS_SQL, [
    gameDate,
    drawn.map((round) => round.ordinal),
    drawn.map((round) => round.locationId),
    drawn.map((round) => round.cycleNo),
  ]);
  return inserted.length;
}

/**
 * Top up the puzzle buffer to `days` ahead of `startDate`.
 *
 * The cron deliberately does NOT produce "today" — it maintains a 30-day
 * runway, so a failed run, a Vercel incident or a two-week outage is invisible
 * to players and self-heals on the next successful invocation.
 *
 * THE LOOP MUST STAY SEQUENTIAL. Each date's bag query reads the puzzle_round
 * rows the previous date just wrote. Promise.all over 30 dates would give every
 * one of them the same snapshot of the used-set and produce 30 near-identical
 * puzzles — the most tempting and most damaging refactor available here.
 */
export async function topUpBuffer(
  sql: SqlExecutor,
  startDate: string,
  days: number,
): Promise<TopUpResult> {
  // One cheap query up front instead of an existence check per date: on a
  // healthy night this turns 29 of the 30 iterations into pure no-ops.
  const existingRows = await sql(EXISTING_PUZZLE_DATES_SQL, [startDate, days]);
  const existing = new Set(existingRows.map((row) => String(row.game_date)));

  const generated: string[] = [];
  const skipped: string[] = [];

  for (let offset = 0; offset < days; offset++) {
    const gameDate = addDays(startDate, offset);
    if (existing.has(gameDate)) {
      skipped.push(gameDate);
      continue;
    }
    const inserted = await generateDate(sql, gameDate);
    if (inserted > 0) {
      generated.push(gameDate);
    } else {
      // Lost the race to a concurrent invocation; the date is covered either
      // way, which is all the buffer cares about.
      skipped.push(gameDate);
    }
  }

  return { generated, skipped };
}
