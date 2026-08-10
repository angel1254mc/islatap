import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlExecutor } from '../_lib/db.js';
import { setSqlForTest } from '../_lib/db.js';
import { addDays, todayInAst } from '../_lib/date.js';
import { EXISTING_PUZZLE_DATES_SQL } from '../_lib/puzzle.js';
import handler, { BUFFER_DAYS, isAuthorized } from './top-up.js';

const SECRET = 'test-cron-secret';

/** Records whether the database was touched at all. */
function createSpySql(): { sql: SqlExecutor; calls: string[] } {
  const calls: string[] = [];
  const sql: SqlExecutor = async (text) => {
    calls.push(text);
    // Answering only the buffer-window query makes every date look already
    // generated, so the handler completes without needing a full fake database.
    //
    // The window is built with todayInAst()/addDays -- the SAME clock the
    // handler starts from -- and not with Date.now() + toISOString().slice(0,10).
    // The latter is UTC; the handler is UTC-4, so between 00:00 and 04:00 UTC
    // the two disagree by a day, the handler's first date would be missing from
    // this list, it would fall through to BAG_CANDIDATES_SQL, hit the throw
    // below and 500. That is a test red for four hours every night, and it is
    // exactly the bug class todayInAst exists to prevent -- including here.
    if (text === EXISTING_PUZZLE_DATES_SQL) {
      const start = todayInAst();
      return Array.from({ length: BUFFER_DAYS }, (_, offset) => ({
        game_date: addDays(start, offset),
      }));
    }
    throw new Error(`Unexpected SQL:\n${text}`);
  };
  return { sql, calls };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  setSqlForTest(null);
  delete process.env.CRON_SECRET;
});

describe('isAuthorized', () => {
  it('accepts only the exact bearer token Vercel sends', () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorized(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isAuthorized('Bearer wrong', SECRET)).toBe(false);
    // A token of a different length must be rejected, not thrown on:
    // timingSafeEqual raises on mismatched buffer lengths, and an exception
    // here would surface as a 500 -- indistinguishable from a real outage.
    expect(isAuthorized(`Bearer ${SECRET}-but-much-longer`, SECRET)).toBe(false);
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
    expect(isAuthorized(null, SECRET)).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    // The endpoint is publicly routable. An unset CRON_SECRET must fail closed,
    // never open — "no secret configured" is the state a fresh preview
    // deployment is in. The handler collapses `undefined` to '' at the call
    // site, so '' is the sentinel this function has to reject.
    expect(isAuthorized('Bearer ', '')).toBe(false);
    expect(isAuthorized('Bearer anything', '')).toBe(false);
    expect(isAuthorized(null, '')).toBe(false);
  });
});

describe('GET /api/cron/top-up', () => {
  it('returns 401 and never touches the database without the header', async () => {
    const spy = createSpySql();
    setSqlForTest(spy.sql);

    const response = await handler(new Request('https://islatap.test/api/cron/top-up'));

    expect(response.status).toBe(401);
    expect(spy.calls).toHaveLength(0);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('returns 401 for a wrong secret', async () => {
    const spy = createSpySql();
    setSqlForTest(spy.sql);

    const response = await handler(
      new Request('https://islatap.test/api/cron/top-up', {
        headers: { authorization: 'Bearer not-the-secret' },
      }),
    );

    expect(response.status).toBe(401);
    expect(spy.calls).toHaveLength(0);
  });

  it('returns 401 when CRON_SECRET is not configured at all', async () => {
    // An unconfigured deployment must not expose the only write path in the
    // system to anyone who guesses the URL.
    delete process.env.CRON_SECRET;
    const spy = createSpySql();
    setSqlForTest(spy.sql);

    const response = await handler(
      new Request('https://islatap.test/api/cron/top-up', {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );

    expect(response.status).toBe(401);
    expect(spy.calls).toHaveLength(0);
  });

  it('tops the buffer up and reports what it did', async () => {
    const spy = createSpySql();
    setSqlForTest(spy.sql);

    const response = await handler(
      new Request('https://islatap.test/api/cron/top-up', {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      startDate: string;
      bufferDays: number;
      generated: string[];
      skipped: string[];
    };
    expect(body.bufferDays).toBe(30);
    expect(body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.skipped).toHaveLength(30);
    expect(body.generated).toHaveLength(0);
    expect(spy.calls).toContain(EXISTING_PUZZLE_DATES_SQL);
  });

  it('returns 500 rather than throwing when the database is unreachable', async () => {
    setSqlForTest(async () => {
      throw new Error('connection refused');
    });

    const response = await handler(
      new Request('https://islatap.test/api/cron/top-up', {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'top-up-failed' });
  });
});
