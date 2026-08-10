import type { ResultRow } from './round-state';

/**
 * The narrow slice of the Storage interface this module uses. Taking it as a
 * parameter rather than reaching for window.localStorage directly is what
 * makes the module testable: the repo's Vitest environment is 'node', where
 * there is no window at all, and adding jsdom to test twenty lines of
 * persistence would buy a devDependency for nothing.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HISTORY_KEY = 'islatap:history:v1';

/**
 * The pre-daily key: a bare number, no date, no version. Live players have it
 * in their browsers right now, so it is migrated into `legacyBest` rather than
 * dropped — dropping it visibly regresses a returning player's Best score.
 */
export const LEGACY_BEST_KEY = 'islatap:best-score';

export interface DayEntry {
  total: number;
  /**
   * Enough to re-render the results table on a reload. Deliberately not the
   * full PlayedRound: boundary geometry can run to 8 KB per round and would
   * blow through the localStorage quota within a couple of months.
   */
  rows: ResultRow[];
  playedAt: string;
}

/**
 * Named GameHistory rather than History on purpose: `History` is a DOM global
 * (the type of window.history), and a local type with that name shadows it in
 * every module that imports it.
 */
export interface GameHistory {
  version: 1;
  /** Keyed by the server's 'YYYY-MM-DD' gameDate — never by a client clock. */
  days: Record<string, DayEntry>;
  legacyBest: number | null;
}

export const EMPTY_HISTORY: GameHistory = { version: 1, days: {}, legacyBest: null };

const MS_PER_DAY = 86_400_000;

/**
 * Calendar arithmetic on the 'YYYY-MM-DD' string, anchored in UTC.
 *
 * new Date('2026-08-05') would be parsed as UTC midnight and then rendered in
 * the viewer's zone, which in Puerto Rico (UTC-4, no DST) reads as the 4th.
 * Building the instant field by field through Date.UTC and reading it back
 * with toISOString keeps the whole round trip in one zone, so a streak can
 * never gain or lose a day depending on where the player is standing.
 */
function shiftDate(gameDate: string, days: number): string {
  const [year, month, day] = gameDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function previousDate(gameDate: string): string {
  return shiftDate(gameDate, -1);
}

export function nextDate(gameDate: string): string {
  return shiftDate(gameDate, 1);
}

function defaultStorage(): StorageLike | null {
  // typeof guard rather than try/catch around window: this module is imported
  // by tests running in Node, where a bare `window` reference is a
  // ReferenceError at evaluation, not something a catch would tidily absorb.
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Storage disabled by policy. Everything below degrades to in-memory.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLegacyBest(storage: StorageLike): number | null {
  try {
    const raw = storage.getItem(LEGACY_BEST_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Never throws. This is read from a useState lazy initialiser, i.e. during
 * render, and the app has no error boundary — a throw here is a white screen
 * for anyone whose stored blob got truncated.
 */
export function loadHistory(storage: StorageLike | null = defaultStorage()): GameHistory {
  if (!storage) return EMPTY_HISTORY;
  const legacyBest = readLegacyBest(storage);
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (raw === null) return { ...EMPTY_HISTORY, legacyBest };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.days)) {
      return { ...EMPTY_HISTORY, legacyBest };
    }
    const days: Record<string, DayEntry> = {};
    for (const [gameDate, entry] of Object.entries(parsed.days)) {
      if (!isRecord(entry)) continue;
      if (typeof entry.total !== 'number' || !Number.isFinite(entry.total)) continue;
      if (!Array.isArray(entry.rows)) continue;
      days[gameDate] = {
        total: entry.total,
        rows: entry.rows as ResultRow[],
        playedAt: typeof entry.playedAt === 'string' ? entry.playedAt : '',
      };
    }
    return {
      version: 1,
      days,
      legacyBest: typeof parsed.legacyBest === 'number' ? parsed.legacyBest : legacyBest,
    };
  } catch {
    return { ...EMPTY_HISTORY, legacyBest };
  }
}

/**
 * Write one completed day. First write wins: a mid-day reload must restore the
 * finished game, not hand out a second attempt at a better score.
 *
 * Returns the new history even when persistence fails, so the running session
 * still shows the right streak in private-browsing mode.
 */
export function recordDay(
  history: GameHistory,
  gameDate: string,
  entry: DayEntry,
  storage: StorageLike | null = defaultStorage(),
): GameHistory {
  if (history.days[gameDate]) return history;
  const next: GameHistory = { ...history, days: { ...history.days, [gameDate]: entry } };
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage disabled — the game itself is unaffected.
  }
  return next;
}

export function entryFor(history: GameHistory, gameDate: string): DayEntry | null {
  return history.days[gameDate] ?? null;
}

/**
 * Consecutive days played ending at `gameDate`, or 0 if that day itself has
 * not been played. Derived by walking backwards rather than stored, so
 * deleting or never writing a day can never leave a stale counter behind.
 *
 * Note the anchor matters as much as the walk: passing "the most recent date
 * on record" would report a streak that ended a month ago as if it were live.
 * Callers anchor on today (or yesterday, since today is not over yet).
 */
export function streakEndingAt(history: GameHistory, gameDate: string): number {
  let streak = 0;
  let cursor = gameDate;
  while (history.days[cursor]) {
    streak += 1;
    cursor = previousDate(cursor);
  }
  return streak;
}

export function bestTotal(history: GameHistory): number | null {
  const totals = Object.values(history.days).map((entry) => entry.total);
  if (history.legacyBest !== null) totals.push(history.legacyBest);
  return totals.length === 0 ? null : Math.max(...totals);
}
