import { describe, expect, it } from 'vitest';
import {
  describeTarget,
  diffLocations,
  haversineKm,
  parseArgs,
  parseEnvFile,
  resolveDatabaseUrl,
} from './sync-locations.mjs';

const POOLED = 'postgresql://u:p@ep-example-123456-pooler.us-east-2.aws.neon.tech/islatap?sslmode=require';

/** A local row as loadSeedData() produces it. */
function local(over = {}) {
  return {
    id: 80,
    name: 'Castillo San Cristóbal',
    municipio: null,
    category: 'landmark',
    subtype: 'landmark',
    difficulty: 'medium',
    source: 'curated',
    geoid: null,
    radiusKm: 0.15,
    lat: 18.46728,
    lng: -66.11081,
    ...over,
  };
}

/** The same row as the database hands it back: snake_case, maybe stringy. */
function remote(over = {}) {
  return {
    id: 80,
    name: 'Castillo San Cristóbal',
    municipio: null,
    category: 'landmark',
    subtype: 'landmark',
    difficulty: 'medium',
    source: 'curated',
    geoid: null,
    radius_km: 0.15,
    lat: 18.46728,
    lng: -66.11081,
    ...over,
  };
}

describe('parseEnvFile', () => {
  it('reads KEY=VALUE, skipping blanks and comments', () => {
    expect(parseEnvFile('# note\n\nDATABASE_URL=postgres://x\nCRON_SECRET=abc\n')).toEqual({
      DATABASE_URL: 'postgres://x',
      CRON_SECRET: 'abc',
    });
  });

  it('strips one matched pair of quotes', () => {
    expect(parseEnvFile('A="one"\nB=\'two\'\nC=three').A).toBe('one');
    expect(parseEnvFile('A="one"\nB=\'two\'\nC=three').B).toBe('two');
    expect(parseEnvFile('A="one"\nB=\'two\'\nC=three').C).toBe('three');
  });

  it('accepts an export prefix and CRLF line endings', () => {
    expect(parseEnvFile('export DATABASE_URL=postgres://x\r\n')).toEqual({
      DATABASE_URL: 'postgres://x',
    });
  });

  it('keeps everything after the first = , including # and more =', () => {
    // A connection string is full of punctuation. Guessing where a comment
    // starts would silently truncate a password.
    const parsed = parseEnvFile('DATABASE_URL=postgres://u:p#a=b@host/db?sslmode=require');
    expect(parsed.DATABASE_URL).toBe('postgres://u:p#a=b@host/db?sslmode=require');
  });
});

describe('parseArgs', () => {
  it('defaults to reading, not writing', () => {
    const opts = parseArgs([]);
    expect(opts.dryRun).toBe(false);
    expect(opts.yes).toBe(false);
    expect(opts.databaseUrl).toBeNull();
  });

  it('accepts --env and the --env-file spelling', () => {
    expect(parseArgs(['--env=.env.production']).envFile).toBe('.env.production');
    expect(parseArgs(['--env-file=.env.production']).envFile).toBe('.env.production');
  });

  it('parses the remaining flags', () => {
    const opts = parseArgs(['--database-url=postgres://x', '--dry-run', '-y']);
    expect(opts).toMatchObject({ databaseUrl: 'postgres://x', dryRun: true, yes: true });
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--force'])).toThrow(/Unknown argument: --force/);
  });
});

describe('resolveDatabaseUrl', () => {
  it('prefers --database-url over the environment', () => {
    const got = resolveDatabaseUrl(parseArgs(['--database-url=postgres://flag']), {
      DATABASE_URL: 'postgres://env',
    });
    expect(got).toEqual({ url: 'postgres://flag', from: '--database-url' });
  });

  it('falls back to the environment, which is where node --env-file lands', () => {
    const got = resolveDatabaseUrl(parseArgs([]), { DATABASE_URL: 'postgres://env' });
    expect(got.url).toBe('postgres://env');
    expect(got.from).toBe('process.env.DATABASE_URL');
  });

  it('names a missing --env file instead of failing obscurely later', () => {
    expect(() => resolveDatabaseUrl(parseArgs(['--env=definitely-not-here.env']), {})).toThrow(
      /--env: no such file/,
    );
  });
});

describe('describeTarget', () => {
  it('returns the host and never the password', () => {
    expect(describeTarget(POOLED)).toBe('ep-example-123456-pooler.us-east-2.aws.neon.tech');
    expect(describeTarget(POOLED)).not.toContain('p@');
  });

  it('does not throw on a malformed connection string', () => {
    expect(describeTarget('not a url')).toMatch(/unparseable/);
  });
});

describe('diffLocations', () => {
  it('reports nothing when the database already matches', () => {
    const d = diffLocations([local()], [remote()]);
    expect(d).toMatchObject({ added: [], moved: [], changed: [], orphaned: [] });
  });

  it('tolerates coordinates returned as strings', () => {
    // double precision can arrive as a string over the wire; comparing with
    // === would report every row in the table as changed.
    const d = diffLocations([local()], [remote({ lat: '18.46728', lng: '-66.11081' })]);
    expect(d.moved).toEqual([]);
  });

  it('reports a moved coordinate with the distance', () => {
    const d = diffLocations([local()], [remote({ lat: 18.4692, lng: -66.1122 })]);
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0].km).toBeCloseTo(0.259, 2);
    expect(d.moved[0].from).toEqual({ lat: 18.4692, lng: -66.1122 });
  });

  it('reports a changed field separately from a move', () => {
    const d = diffLocations([local()], [remote({ difficulty: 'hard' })]);
    expect(d.moved).toEqual([]);
    expect(d.changed[0].fields).toEqual(['difficulty']);
  });

  it('notices a radius change, including a numeric string', () => {
    expect(diffLocations([local()], [remote({ radius_km: 0.3 })]).changed[0].fields).toContain(
      'radiusKm',
    );
    expect(diffLocations([local()], [remote({ radius_km: '0.15' })]).changed).toEqual([]);
  });

  it('lists a location the database has never seen', () => {
    const d = diffLocations([local({ id: 999 })], []);
    expect(d.added).toHaveLength(1);
    expect(d.moved).toEqual([]);
  });

  it('reports a database row missing from the files without proposing a delete', () => {
    const d = diffLocations([], [remote()]);
    expect(d.orphaned).toHaveLength(1);
    expect(d.added).toEqual([]);
  });
});

describe('haversineKm', () => {
  it('measures the San Cristóbal defect', () => {
    // The subbarrio centroid that shipped, against the fort's footprint.
    const km = haversineKm({ lat: 18.4692, lng: -66.1122 }, { lat: 18.46728, lng: -66.11081 });
    expect(km).toBeCloseTo(0.259, 2);
  });

  it('is zero for a point against itself', () => {
    expect(haversineKm({ lat: 18.4, lng: -66.1 }, { lat: 18.4, lng: -66.1 })).toBe(0);
  });
});
