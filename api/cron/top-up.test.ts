import { describe, expect, it } from 'vitest';
import handler, { isAuthorized } from './top-up';

// isAuthorized takes the RAW header value, not a Headers object: that is
// exactly what request.headers.get('authorization') hands back (string or
// null), it keeps the function trivially testable without constructing a
// Request, and it is the signature Task 6 keeps when it replaces this file
// with the real top-up job.
describe('isAuthorized', () => {
  it('accepts the exact bearer token Vercel injects', () => {
    expect(isAuthorized('Bearer s3cret', 's3cret')).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(isAuthorized('Bearer nope', 's3cret')).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isAuthorized(null, 's3cret')).toBe(false);
  });

  it('rejects a token of a different length without throwing', () => {
    // timingSafeEqual throws on length mismatch, so the length guard must
    // come first. A crash here would be a 500 -- indistinguishable from a
    // real outage in the cron dashboard.
    expect(isAuthorized('Bearer s3cret-but-longer', 's3cret')).toBe(false);
  });

  it('denies everything when the secret is empty', () => {
    // Fail closed. An unconfigured deployment must not expose a write
    // endpoint to the public internet just because the env var is missing.
    // The handler normalises an unset process.env.CRON_SECRET to '' before
    // calling in, so '' is precisely the "not configured" case.
    expect(isAuthorized('Bearer anything', '')).toBe(false);
    expect(isAuthorized(null, '')).toBe(false);
  });
});

describe('api/cron/top-up handler', () => {
  it('401s an unauthenticated request', async () => {
    const response = await handler(new Request('https://islatap.test/api/cron/top-up'));
    expect(response.status).toBe(401);
  });
});
