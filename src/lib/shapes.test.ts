import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MultiPolygon } from './scoring';
import { getShape, resetShapesForTest, startShapeLoad } from './shapes';

const SQUARE: MultiPolygon = [
  [
    [
      [18.0, -66.5],
      [18.0, -66.4],
      [18.1, -66.4],
      [18.1, -66.5],
      [18.0, -66.5],
    ],
  ],
];

afterEach(() => {
  resetShapesForTest();
  vi.unstubAllGlobals();
});

describe('shapes loader', () => {
  it('returns undefined before any load', () => {
    expect(getShape('72127')).toBeUndefined();
    expect(getShape(undefined)).toBeUndefined();
  });

  it('serves shapes once the fetch resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ '72127': SQUARE }) }),
    );
    await startShapeLoad();
    expect(getShape('72127')).toEqual(SQUARE);
    expect(getShape('99999')).toBeUndefined();
  });

  it('fetches only once across repeated calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([startShapeLoad(), startShapeLoad()]);
    await startShapeLoad();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swallows network failure and keeps returning undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(startShapeLoad()).resolves.toBeUndefined();
    expect(getShape('72127')).toBeUndefined();
  });

  it('treats an HTTP error as a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(startShapeLoad()).resolves.toBeUndefined();
    expect(getShape('72127')).toBeUndefined();
  });
});
