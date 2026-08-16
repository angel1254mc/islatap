import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splitStatements } from './migrate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('splitStatements', () => {
  it('splits on top-level semicolons and trims each statement', () => {
    const out = splitStatements('SELECT 1;\n  SELECT 2;\n');
    expect(out).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('tolerates a missing trailing semicolon', () => {
    expect(splitStatements('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('drops chunks that are only whitespace or comments', () => {
    // The tail of every real migration file is a newline after the last
    // semicolon. Sending that empty string to Postgres is an error.
    const out = splitStatements('SELECT 1;\n-- trailing note\n\n');
    expect(out).toEqual(['SELECT 1']);
  });

  it('does not split on a semicolon inside a line comment', () => {
    // This is the whole reason for a scanner instead of source.split(";").
    // The repo's comment style is dense and prose-like; a stray semicolon in
    // a WHY comment must not sever a CREATE TABLE in half.
    const out = splitStatements('-- one; two; three\nSELECT 1;\n');
    expect(out).toEqual(['-- one; two; three\nSELECT 1']);
  });

  it('does not split on a semicolon inside a string literal', () => {
    const out = splitStatements("INSERT INTO t VALUES ('a;b');\nSELECT 1;\n");
    expect(out).toEqual(["INSERT INTO t VALUES ('a;b')", 'SELECT 1']);
  });

  it('does not split on a semicolon inside a block comment', () => {
    const out = splitStatements('/* a; b */ SELECT 1;\n');
    expect(out).toEqual(['/* a; b */ SELECT 1']);
  });

  it('refuses dollar-quoted bodies rather than mis-splitting them', () => {
    // $$ ... $$ can contain anything, including semicolons, and this scanner
    // does not track it. Throwing is the honest outcome: a silently truncated
    // function body would deploy as a half-written trigger.
    expect(() => splitStatements('CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;'))
      .toThrow(/dollar-quoted/i);
  });

  it('tolerates a comment that merely mentions $$', () => {
    // The refusal above must fire only on $$ reached in CODE context. This
    // file's SQL is dense English prose, and a comment discussing dollar
    // quoting (e.g. explaining why the runner rejects it) must not make the
    // entire migration unrunnable.
    const out = splitStatements('-- no $$ bodies here, by design\nSELECT 1;\n');
    expect(out).toEqual(['-- no $$ bodies here, by design\nSELECT 1']);
  });
});

describe('migrations/001_initial.sql', () => {
  const source = readFileSync(join(ROOT, 'migrations', '001_initial.sql'), 'utf8');
  const statements = splitStatements(source);

  it('splits into the six expected statements', () => {
    expect(statements).toHaveLength(6);
    for (const statement of statements) {
      expect(statement.length).toBeGreaterThan(0);
      // A stray semicolon surviving in CODE means the scanner mis-parsed and
      // Postgres will reject the batch at deploy time. Comments are stripped
      // first because the semicolons in this file's prose ("...the scheduled
      // top-up job; /api/guess is a pure function with zero writes.") are
      // exactly what the scanner is supposed to carry through untouched --
      // asserting on the raw text would fail on three of the six statements
      // and would be testing the opposite of the intended behaviour.
      const bare = statement.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(bare).not.toContain(';');
    }
  });

  it('creates every table the architecture depends on', () => {
    const created = statements
      .map((s) => /CREATE TABLE (\w+)/.exec(s))
      .filter((match) => match !== null)
      .map((match) => match[1]);

    expect(created.sort()).toEqual(['daily_puzzle', 'location', 'puzzle_round', 'shape']);
  });

  it('enforces the geoid-XOR-radius invariant that discriminates SHAPE from CIRCLE', () => {
    // Every one of the 1088 locations has exactly one of geoid / radius_km:
    // 1063 carry a geoid, 25 carry a radius, zero carry both, zero carry
    // neither. That XOR *is* the api/guess.ts target discriminant, so it has
    // to be a database constraint, not a convention.
    expect(source).toContain('CHECK ((geoid IS NULL) <> (radius_km IS NULL))');
  });

  it('gives puzzle_round an opaque uuid primary key', () => {
    // The stable location id must never reach the browser or a player can
    // build an id -> coordinate dictionary. The uuid is the only round handle
    // the client ever sees.
    expect(source).toMatch(/id\s+uuid\s+PRIMARY KEY\s+DEFAULT gen_random_uuid\(\)/);
  });
});
