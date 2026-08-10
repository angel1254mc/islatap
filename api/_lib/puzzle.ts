import type { Category } from '../../src/data/types';
import { epochDay } from './date';

/**
 * Rounds in one daily puzzle.
 *
 * Duplicated from ROUNDS_PER_GAME in src/lib/game.ts rather than imported:
 * game.ts imports LOCATIONS at module scope, so importing anything from it here
 * would pull all 1088 rows — every lat/lng in the game — into the serverless
 * bundle, which is precisely what moving the data into Postgres exists to stop.
 */
export const ROUNDS_PER_DAY = 5;

export interface CategoryMix {
  municipio: number;
  landmark: number;
  barrio: number;
}

/**
 * Landmarks are the scarcest category: 26 against 78 municipios and 984
 * barrios. One per day would burn the whole set in 26 days; one every third day
 * stretches them to 78, which is exactly how long the municipios last at one
 * per day, so those two bags roll over in lockstep.
 *
 * epochDay is non-negative for every date after 1970, so JavaScript's negative-%
 * hazard (-1 % 3 === -1, not 2) cannot fire here.
 */
export function isLandmarkDay(gameDate: string): boolean {
  return epochDay(gameDate) % 3 === 0;
}

/**
 * The category quota for a date. Deterministic and stateless — it depends only
 * on the date, so regenerating a deleted day, or generating the 30-day buffer
 * out of order, always yields the same mix. Nothing about it is stored.
 *
 * This lives in TypeScript rather than in the SQL so the cadence rule is a pure
 * function a unit test can hammer, instead of a date expression only reachable
 * through a live database.
 */
export function dailyMix(gameDate: string): CategoryMix {
  const landmark = isLandmarkDay(gameDate) ? 1 : 0;
  return { municipio: 1, landmark, barrio: ROUNDS_PER_DAY - 1 - landmark };
}

/** One row of BAG_CANDIDATES_SQL, decoded. */
export interface BagCandidate {
  id: number;
  category: Category;
  /**
   * Highest cycle_no this location has ever been drawn at, across ALL dates
   * including future scheduled ones. 0 means it has never been drawn.
   */
  lastCycleNo: number;
  /** Already scheduled for the date being generated. */
  usedOnDate: boolean;
}

export interface DrawnRound {
  ordinal: number;
  locationId: number;
  cycleNo: number;
}

const CATEGORY_ORDER: readonly Category[] = ['municipio', 'landmark', 'barrio'];

/**
 * xmur3 string hash → 32-bit seed. Seeding from the game date (rather than
 * Math.random or ORDER BY random()) makes a day's draw reproducible from its
 * inputs, which is what lets the tests above assert an exact puzzle.
 */
function seedFrom(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: 32 bits of state, uniform enough for picking 5 of 984. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partial Fisher–Yates: the first `count` of a shuffle, without shuffling the rest. */
function takeRandom<T>(items: readonly T[], count: number, random: () => number): T[] {
  const copy = [...items];
  const taken: T[] = [];
  for (let i = 0; i < count && i < copy.length; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
    taken.push(copy[i]);
  }
  return taken;
}

/**
 * Draw one day's rounds from per-category bags.
 *
 * A "bag" is derived, never stored: the current cycle for a category is just the
 * highest cycle_no any location of that category has ever been drawn at, and the
 * bag is everyone who has no row at that cycle. Deleting a date's rows therefore
 * returns its locations to their bag automatically, and there is no counter
 * table to initialise, migrate or repair.
 *
 * Cycles are per category. Municipios roll over every 78 days and barrios every
 * ~268; making the cycle global would drag the big bag along with the small one.
 */
export function drawRounds(candidates: readonly BagCandidate[], gameDate: string): DrawnRound[] {
  const mix = dailyMix(gameDate);
  const random = mulberry32(seedFrom(gameDate));

  // Locations already committed to this date — either by a previous partial run
  // of this same date, or by a pick made moments ago in this very call. This is
  // the guard that survives a mid-puzzle rollover: rounds drawn from the
  // exhausted cycle N are invisible to the cycle N+1 bag (whose used-set is
  // empty by definition), so without it the same barrio could land twice in one
  // game.
  const taken = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.usedOnDate) taken.add(candidate.id);
  }

  const drawn: { locationId: number; cycleNo: number }[] = [];

  for (const category of CATEGORY_ORDER) {
    const want = mix[category];
    if (want === 0) continue;

    const pool = candidates.filter((candidate) => candidate.category === category);
    // COALESCE(MAX(cycle_no), 0) || 1 — a category nobody has ever drawn is on
    // cycle 1, not cycle 0.
    const cycleNo = pool.reduce((max, candidate) => Math.max(max, candidate.lastCycleNo), 0) || 1;

    let need = want;

    const currentBag = pool.filter(
      (candidate) => candidate.lastCycleNo < cycleNo && !taken.has(candidate.id),
    );
    for (const candidate of takeRandom(currentBag, Math.min(need, currentBag.length), random)) {
      drawn.push({ locationId: candidate.id, cycleNo });
      taken.add(candidate.id);
      need--;
    }

    if (need > 0) {
      // The cycle ran dry mid-puzzle. Rather than discarding the leftovers we
      // took above, top up from the next cycle, so one game's rounds may carry
      // two different cycle_no values. The opening bag for cycle N+1 is exactly
      // what cycle N already spent — i.e. everything in the category that is not
      // already committed to this date.
      const nextBag = pool.filter((candidate) => !taken.has(candidate.id));
      for (const candidate of takeRandom(nextBag, Math.min(need, nextBag.length), random)) {
        drawn.push({ locationId: candidate.id, cycleNo: cycleNo + 1 });
        taken.add(candidate.id);
        need--;
      }
    }

    if (need > 0) {
      throw new Error(
        `Cannot fill ${want} ${category} round(s) for ${gameDate}: the category holds only ${pool.length} location(s).`,
      );
    }
  }

  // Server-side equivalent of the final shuffle(picked) in pickGameRounds():
  // without it the municipio would always be round 1 and the landmark round 2.
  return takeRandom(drawn, drawn.length, random).map((round, index) => ({
    ordinal: index + 1,
    locationId: round.locationId,
    cycleNo: round.cycleNo,
  }));
}

/**
 * Everything drawRounds needs, in one round trip: 1088 rows of
 * (id, category, last_cycle_no, used_on_date).
 *
 * The MAX() is over every puzzle_round row that has ever existed — past, today,
 * and the ~30 future days the top-up job has already buffered. Filtering it to
 * `game_date <= CURRENT_DATE` would re-draw locations that are already sitting
 * in the buffer and break the cycle guarantee outright.
 *
 * ORDER BY l.id is load-bearing: the draw is a seeded shuffle of this array, so
 * an unspecified row order would make a day's puzzle unreproducible.
 */
export const BAG_CANDIDATES_SQL = `
SELECT l.id,
       l.category,
       COALESCE(MAX(pr.cycle_no), 0)                     AS last_cycle_no,
       COALESCE(BOOL_OR(pr.game_date = $1::date), false) AS used_on_date
  FROM location l
  LEFT JOIN puzzle_round pr ON pr.location_id = l.id
 GROUP BY l.id, l.category
 ORDER BY l.id
`;

/**
 * Which dates in [$1, $1 + $2) already have a puzzle. to_char, not the raw
 * column: the Postgres driver decodes a `date` into a JavaScript Date at local
 * midnight, which is a timezone bug waiting to happen in a system whose only
 * unit is the calendar day. Every date crosses this boundary as a string.
 */
export const EXISTING_PUZZLE_DATES_SQL = `
SELECT to_char(game_date, 'YYYY-MM-DD') AS game_date
  FROM daily_puzzle
 WHERE game_date >= $1::date
   AND game_date <  $1::date + $2::int
`;

/**
 * Claim a date and write its rounds, atomically, in one statement.
 *
 * The data-modifying CTE is what makes this safe under concurrent cron
 * invocations without an explicit transaction (the Neon HTTP driver has no
 * interactive one): if `daily_puzzle` already has the date, `claimed` is empty,
 * the CROSS JOIN produces no rows, and the whole statement is a no-op that
 * returns zero rows. A concurrent claimer blocks on the uncommitted conflicting
 * row and then also gets nothing. "Rows returned" is therefore an exact
 * did-I-generate-this-date signal.
 *
 * $2/$3/$4 are parallel int[] columns unnested into one row set, so five rounds
 * cost one statement and five parameters instead of five round trips.
 */
export const CLAIM_AND_INSERT_ROUNDS_SQL = `
WITH claimed AS (
  INSERT INTO daily_puzzle (game_date)
  VALUES ($1::date)
  ON CONFLICT (game_date) DO NOTHING
  RETURNING game_date
)
INSERT INTO puzzle_round (game_date, ordinal, location_id, cycle_no)
SELECT c.game_date, d.ordinal, d.location_id, d.cycle_no
  FROM claimed c
  CROSS JOIN unnest($2::int[], $3::int[], $4::int[]) AS d(ordinal, location_id, cycle_no)
ON CONFLICT (game_date, ordinal) DO NOTHING
RETURNING id
`;
