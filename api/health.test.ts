import { describe, expect, it } from 'vitest';
import handler from './health';

// These tests exist to prove the whole serverless toolchain works *before*
// any real endpoint depends on it: that a web-standard (Request) => Response
// handler can be imported and driven from a plain Vitest process with no
// Vercel emulator, no HTTP server, and no database. Every later endpoint
// (api/daily.ts, api/guess.ts) is testable the same way, which is the entire
// reason the architecture mandates the web signature over Node's (req, res).
//
// Both this file and api/health.ts are scaffolding with a scheduled death:
// Task 7 deletes them once /api/daily and /api/guess exercise the same seams
// as real endpoints.
describe('api/health', () => {
  it('answers GET with a JSON heartbeat', async () => {
    const response = await handler(new Request('https://islatap.test/api/health'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = await response.json();
    expect(body.ok).toBe(true);
    // Proves api/ -> src/lib/scoring.ts resolves and executes. San Juan to
    // Ponce is ~74 km; the assertion is loose because the point is that the
    // import worked, not that haversine is correct (scoring.test.ts owns that).
    expect(body.scoringSelfCheckKm).toBeGreaterThan(60);
    expect(body.scoringSelfCheckKm).toBeLessThan(90);
  });

  it('rejects anything other than GET', async () => {
    const response = await handler(
      new Request('https://islatap.test/api/health', { method: 'POST' }),
    );

    // 405 rather than 404: the route exists, the verb does not. Vercel routes
    // every method to the same handler, so method dispatch is the handler's job.
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
