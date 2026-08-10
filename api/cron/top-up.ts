import { timingSafeEqual } from 'node:crypto';
import { todayInAst } from '../_lib/date.js';
import { getSql } from '../_lib/db.js';
import { topUpBuffer } from '../_lib/generate.js';
import { jsonResponse } from '../_lib/http.js';

/** Node, not Edge: node:crypto and the Neon HTTP driver both want it. */
export const config = { runtime: 'nodejs' };

/**
 * How far ahead the buffer runs. At 30 days, a month of failed cron runs is
 * still invisible to players — which is why this job tops up a runway instead
 * of producing "today" and becoming a single point of failure every midnight.
 */
export const BUFFER_DAYS = 30;

/**
 * Vercel invokes cron paths with `Authorization: Bearer $CRON_SECRET` when that
 * environment variable is set. The path stays publicly routable, so this check
 * is the only thing standing between the open internet and the one write path
 * in the entire system — it must fail closed when the secret is missing, which
 * here means rejecting the empty string the handler passes for an unset var.
 *
 * timingSafeEqual throws outright on mismatched buffer lengths, so the length
 * guard has to come first. It leaks the token's length, which is not the
 * secret, and that is the standard accepted tradeoff.
 */
export function isAuthorized(header: string | null, secret: string): boolean {
  if (!secret || header === null) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export default async function handler(request: Request): Promise<Response> {
  // process.env.CRON_SECRET is string | undefined; collapsing the unset case to
  // '' right here keeps isAuthorized's contract a plain string, and '' is the
  // value it treats as "no secret configured" and refuses unconditionally.
  if (!isAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET ?? '')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // The buffer starts at today *in Puerto Rico*. Vercel's clock is UTC, so
  // between 20:00 and 24:00 AST a UTC "today" would already be tomorrow and the
  // near edge of the buffer would silently shrink by a day.
  const startDate = todayInAst();

  try {
    const result = await topUpBuffer(getSql(), startDate, BUFFER_DAYS);
    return jsonResponse({ startDate, bufferDays: BUFFER_DAYS, ...result });
  } catch (error) {
    // Logged, not returned: the message can carry connection details, and the
    // caller is a cron scheduler that only reads the status code.
    console.error('[cron/top-up] failed', error);
    return jsonResponse({ error: 'top-up-failed' }, 500);
  }
}
