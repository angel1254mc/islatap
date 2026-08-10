#!/usr/bin/env node
// Applies migrations/*.sql in filename order, exactly once each.
//
// Run with:  node --env-file=.env scripts/migrate.mjs
// (--env-file is built into Node 20.6+; do NOT add dotenv -- scripts/ in this
// repo is dependency-free on purpose.)
//
// Why a hand-rolled runner instead of a migration tool: the schema is six
// statements in one file, and every migration framework worth using drags in
// more dependencies than the entire application currently has.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

/**
 * True when a chunk contains nothing but whitespace and comments -- i.e. the
 * tail after a file's final semicolon. Postgres rejects an empty query
 * string, so these have to be dropped rather than sent.
 *
 * Regexes are safe HERE (unlike for splitting) because a false positive only
 * ever drops a chunk that was already comment-only.
 */
function isBlank(chunk) {
  const withoutComments = chunk
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  return withoutComments.trim().length === 0;
}

/**
 * Split a .sql file into individual statements.
 *
 * This exists because the Neon HTTP driver sends exactly one statement per
 * request -- it cannot swallow a whole file. And it is a character scanner
 * rather than `source.split(';')` because this repo's comments are dense
 * English prose: a semicolon inside a WHY comment, or inside a string
 * literal, would otherwise sever a CREATE TABLE in half and the failure would
 * surface as an incomprehensible syntax error at deploy time.
 *
 * Deliberately does NOT understand dollar quoting ($$ ... $$), and throws
 * when it sees any, because a silently truncated PL/pgSQL body is far worse
 * than a refusal. If a future migration needs one, teach this scanner about
 * it -- do not work around it.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function splitStatements(source) {
  const statements = [];
  let current = '';
  let i = 0;

  while (i < source.length) {
    const pair = source.slice(i, i + 2);

    // Line comment: copy through to end of line without interpreting anything.
    if (pair === '--') {
      const newline = source.indexOf('\n', i);
      const stop = newline === -1 ? source.length : newline;
      current += source.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment: copy through to the closing marker.
    if (pair === '/*') {
      const close = source.indexOf('*/', i + 2);
      const stop = close === -1 ? source.length : close + 2;
      current += source.slice(i, stop);
      i = stop;
      continue;
    }

    // Dollar quoting, checked HERE rather than with a `source.includes('$$')`
    // pre-scan: the comment branches above have already consumed anything in
    // prose, so this fires only on a $$ reached in real code context. A
    // pre-scan would reject a migration whose *comment* merely mentions $$,
    // with an error message describing a problem the file does not have.
    if (pair === '$$') {
      throw new Error(
        'splitStatements: dollar-quoted string ($$) found. This scanner cannot ' +
          'safely find statement boundaries inside one. Extend the scanner or ' +
          'move the function body into its own migration applied by hand.',
      );
    }

    const ch = source[i];

    // String literal ('...') or quoted identifier ("..."). Postgres escapes an
    // embedded quote by doubling it, which this handles for free: the first of
    // the pair closes the literal and the second immediately opens a new one,
    // so the scanner never leaves quoted context in the middle.
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j++;
      current += source.slice(i, Math.min(j + 1, source.length));
      i = j + 1;
      continue;
    }

    if (ch === ';') {
      statements.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  statements.push(current);

  return statements.map((s) => s.trim()).filter((s) => !isBlank(s));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in, then run:');
    console.error('  node --env-file=.env scripts/migrate.mjs');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  // The ledger cannot itself live in a migration file -- it is what decides
  // whether a migration file has run. CREATE TABLE IF NOT EXISTS makes
  // bootstrapping idempotent.
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename    text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const appliedRows = await sql`SELECT filename FROM schema_migration`;
  const applied = new Set(appliedRows.map((row) => row.filename));

  // Lexicographic sort is the ordering. That is why files are numbered with a
  // zero-padded prefix (001_, 002_, ...) -- '10_x.sql' would otherwise sort
  // before '2_x.sql'.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error(`No .sql files found in ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  let appliedCount = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip     ${file}`);
      continue;
    }

    const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

    // One transaction per file, with the ledger insert as its final statement.
    // Postgres has transactional DDL, so a failure halfway through leaves the
    // schema untouched AND leaves the file unrecorded -- re-running after the
    // fix is safe. sql.transaction() is the Neon HTTP driver's only
    // transaction primitive: an array of independent queries, which is exactly
    // what this is (no statement reads another's result).
    await sql.transaction([
      ...statements.map((statement) => sql.query(statement)),
      sql.query('INSERT INTO schema_migration (filename) VALUES ($1)', [file]),
    ]);

    console.log(`  applied  ${file}  (${statements.length} statements)`);
    appliedCount++;
  }

  console.log(
    appliedCount === 0
      ? 'Schema already up to date.'
      : `Applied ${appliedCount} migration(s).`,
  );
}

// Only touch the database when invoked as a script. scripts/migrate.test.mjs
// imports splitStatements from this module, and an import must never open a
// connection or a test run would need a live database.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
