import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MultiPolygon } from './scoring';
import { getShape, getShapesByLayer, resetShapesForTest, startShapeLoad } from './shapes';

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

  it('rejects a malformed shape entry instead of returning it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ '72127': {} }) }),
    );
    await startShapeLoad();
    expect(getShape('72127')).toBeUndefined();
  });
});

describe('getShapesByLayer', () => {
  // GEOID length encodes the Census layer: 5 county, 7 place, 10 cousub, 15 subbarrio.
  const LOADED = {
    '72127': SQUARE, //            municipio (county)
    '7241767': SQUARE, //          comunidad (place)
    '7212779693': SQUARE, //       barrio (cousub)
    '721277969319927': SQUARE, //  subbarrio
  };

  async function loadFixture() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => LOADED }));
    await startShapeLoad();
  }

  it('returns an empty list before any load', () => {
    expect(getShapesByLayer('municipio')).toEqual([]);
    expect(getShapesByLayer('all')).toEqual([]);
  });

  it('buckets each layer by geoid length', async () => {
    await loadFixture();
    expect(getShapesByLayer('municipio').map(([g]) => g)).toEqual(['72127']);
    expect(getShapesByLayer('comunidad').map(([g]) => g)).toEqual(['7241767']);
    expect(getShapesByLayer('barrio').map(([g]) => g)).toEqual(['7212779693']);
    expect(getShapesByLayer('subbarrio').map(([g]) => g)).toEqual(['721277969319927']);
  });

  it('returns everything for the all layer', async () => {
    await loadFixture();
    expect(getShapesByLayer('all')).toHaveLength(4);
  });
});
