import { timingSafeEqual } from 'node:crypto';

export const config = { runtime: 'nodejs' };

/**
 * Vercel invokes cron paths with `Authorization: Bearer $CRON_SECRET` when a
 * CRON_SECRET environment variable is set. The path is still publicly
 * routable, so this check is the *only* thing standing between the internet
 * and the one write path in the entire production system.
 *
 * Takes the raw header value (`string | null`, straight out of
 * `request.headers.get('authorization')`) and a plain `string` secret. The
 * caller normalises an unset env var to '' -- an empty secret denies
 * everyone, so an unconfigured deployment fails closed rather than open.
 *
 * Constant-time comparison via timingSafeEqual, which throws when the two
 * buffers differ in length -- hence the explicit length guard first. That
 * guard does leak the secret's length to an attacker, which is the standard
 * and accepted tradeoff (length alone is not usefully exploitable).
 */
export function isAuthorized(header: string | null, secret: string): boolean {
  if (!secret) return false;
  if (!header) return false;

  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(header, 'utf8');
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

/**
 * Scheduled buffer top-up. Intentionally a no-op stub at this stage: the
 * vercel.json cron entry has to point at a function that already exists, and
 * the puzzle-generation task fills this body in later (Task 6 replaces this
 * whole file).
 *
 * `implemented: false` is in the response on purpose. A stub that returns a
 * bare `{ ok: true }` is indistinguishable from a working job in the Vercel
 * cron log, which is exactly how a silently-dead scheduler happens.
 */
export default async function handler(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET ?? '')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, buffered: 0, implemented: false }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
