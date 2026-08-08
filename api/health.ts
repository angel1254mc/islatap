import { haversineKm, type LatLng } from '../src/lib/scoring';

// Node runtime, not Edge. Edge would forbid node:crypto (used by the cron's
// constant-time secret comparison) and gives no advantage here: the daily
// puzzle is a once-a-day fetch, not a latency-critical hot path.
export const config = { runtime: 'nodejs' };

const SAN_JUAN: LatLng = { lat: 18.46633, lng: -66.10572 };
const PONCE: LatLng = { lat: 18.01031, lng: -66.62398 };

/**
 * Deployment smoke test. Deliberately touches every seam that can break
 * independently of application logic:
 *   - the web-standard handler signature actually being invoked by Vercel,
 *   - `../src/lib/scoring` resolving across the api/ <-> src/ boundary once
 *     the bundler (esbuild, not Vite) is the one doing the resolving,
 *   - environment variables being present in the deployed environment.
 *
 * It reports whether DATABASE_URL and CRON_SECRET are *set*, never their
 * values. Even so this is TEMPORARY: an unauthenticated endpoint that
 * enumerates which secrets a deployment has configured is a reconnaissance
 * gift, and it only earns its keep while nothing else proves the toolchain.
 * Task 7 deletes this file once /api/daily and /api/guess exist.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'GET' },
    });
  }

  const body = {
    ok: true,
    runtime: 'nodejs',
    nodeVersion: process.version,
    hasDatabaseUrl: typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0,
    hasCronSecret: typeof process.env.CRON_SECRET === 'string' && process.env.CRON_SECRET.length > 0,
    scoringSelfCheckKm: haversineKm(SAN_JUAN, PONCE),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // Never cache a health check at the CDN, or you are reading the state
      // of a deployment that may no longer exist.
      'cache-control': 'no-store',
    },
  });
}
