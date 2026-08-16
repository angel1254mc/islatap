/**
 * Calendar-date arithmetic for the daily puzzle.
 *
 * Every date in this system is a *calendar* date in Puerto Rico, never an
 * instant. It is passed around as a 'YYYY-MM-DD' string and stored in a
 * Postgres `date` column. Nothing here ever constructs a local-time Date, and
 * nothing ever calls toISOString() on "now": Vercel's runtime is UTC and a
 * developer laptop is not, and a one-day drift silently shifts the landmark
 * cadence and hands players the wrong puzzle for four hours a night.
 */

/** Puerto Rico: Atlantic Standard Time, UTC-4, no DST anywhere in the year. */
export const GAME_TIME_ZONE = 'America/Puerto_Rico';

const MS_PER_DAY = 86_400_000;
const GAME_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Days since 1970-01-01 for a 'YYYY-MM-DD' game date.
 *
 * Parsed field-by-field into Date.UTC rather than `new Date(str)` so the result
 * can never depend on the host's zone. The round-trip check at the end is not
 * paranoia: Date.UTC happily normalises 2026-02-30 into 2026-03-02 and
 * 2026-13-01 into 2027-01-01, so without it a typo becomes a real, wrong date.
 */
export function epochDay(gameDate: string): number {
  if (!GAME_DATE_RE.test(gameDate)) {
    throw new Error(`Not a YYYY-MM-DD game date: ${JSON.stringify(gameDate)}`);
  }
  const [year, month, day] = gameDate.split('-').map(Number);
  const result = Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  if (!Number.isFinite(result) || fromEpochDay(result) !== gameDate) {
    throw new Error(`Not a real calendar date: ${JSON.stringify(gameDate)}`);
  }
  return result;
}

/** Inverse of epochDay. */
export function fromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `gameDate` shifted by whole days, staying on the calendar (no DST, no hours). */
export function addDays(gameDate: string, days: number): string {
  return fromEpochDay(epochDay(gameDate) + days);
}

/**
 * The current game date in Puerto Rico.
 *
 * Intl with the 'en-CA' locale emits exactly YYYY-MM-DD, so this needs no
 * formatting library and no dependency — which matters in a repo that ships
 * four runtime dependencies on purpose.
 */
export function todayInAst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: GAME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
