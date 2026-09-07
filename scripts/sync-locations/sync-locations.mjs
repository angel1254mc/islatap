#!/usr/bin/env node
// Syncs a deployed database to the location data in this checkout, showing
// exactly what will change before it changes it.
//
// See ./README.md for when to use this instead of `npm run db:seed`, how
// DATABASE_URL is resolved, and what the sync deliberately does not do.

import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { assertSeedInvariants, loadSeedData, seedLocations, seedShapes } from '../seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const USAGE = [
  'Sync a deployed database to the location data in this checkout.',
  '',
  'Usage:',
  '  node scripts/sync-locations/sync-locations.mjs [options]',
  '',
  'Options:',
  '  --database-url=<url>  Neon connection string. Highest precedence.',
  '  --env=<path>          Read DATABASE_URL from this file. Defaults to .env',
  '                        when it exists.',
  '  --dry-run             Print the diff and exit without writing.',
  '  --yes, -y             Skip the confirmation prompt. Required when stdin is',
  '                        not a TTY, so CI must opt in explicitly.',
  '  --help, -h            Show this message.',
  '',
  'Resolution order for DATABASE_URL:',
  '  --database-url  >  --env  >  process.env  >  ./.env',
  '',
  "Node's own --env-file also works and lands in process.env:",
  '  node --env-file=.env.production scripts/sync-locations/sync-locations.mjs',
].join('\n');

const SELECT_LOCATIONS =
  'SELECT id, name, municipio, category, subtype, difficulty, source, geoid, radius_km, lat, lng FROM location';

/**
 * Parse a dotenv file. Deliberately minimal: KEY=VALUE, # comments, optional
 * surrounding quotes, optional `export` prefix. No interpolation and no
 * multi-line values -- scripts/ in this repo takes no dependencies, and a
 * connection string needs none of that.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();

    // Strip one matched pair of quotes. An unquoted value keeps everything
    // after the '=', trailing '#' included: a connection string is full of
    // punctuation, and guessing where a comment starts would silently corrupt
    // a password.
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];

    if (key) out[key] = value;
  }

  return out;
}

/**
 * @param {string[]} argv
 *
 * The flag is `--env`, NOT `--env-file`, and that is deliberate: Node itself
 * claims `--env-file` anywhere in argv, script arguments included. It loads the
 * file into process.env and, when the path does not exist, exits with its own
 * `node: nope.env: not found` before this script ever runs -- so a friendlier
 * message here would be unreachable. Node's flag still works and is handled by
 * the process.env branch of resolveDatabaseUrl; `--env-file=` is accepted here
 * too, for whoever types it out of habit.
 */
export function parseArgs(argv) {
  const opts = { databaseUrl: null, envFile: null, dryRun: false, yes: false, help: false };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg.startsWith('--database-url=')) opts.databaseUrl = arg.slice('--database-url='.length);
    else if (arg.startsWith('--env=')) opts.envFile = arg.slice('--env='.length);
    else if (arg.startsWith('--env-file=')) opts.envFile = arg.slice('--env-file='.length);
    else throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }

  return opts;
}

/**
 * Resolve DATABASE_URL and report which source won. A sync pointed at the
 * wrong database is the failure mode worth spending a line of output on.
 *
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string, from: string }}
 */
export function resolveDatabaseUrl(opts, env = process.env) {
  if (opts.databaseUrl) return { url: opts.databaseUrl, from: '--database-url' };

  if (opts.envFile) {
    const path = resolve(ROOT, opts.envFile);
    if (!existsSync(path)) throw new Error(`--env: no such file: ${path}`);
    const parsed = parseEnvFile(readFileSync(path, 'utf8'));
    if (!parsed.DATABASE_URL) throw new Error(`--env: ${opts.envFile} sets no DATABASE_URL`);
    return { url: parsed.DATABASE_URL, from: opts.envFile };
  }

  // Covers `node --env-file=.env scripts/sync-locations/sync-locations.mjs`, which is how the
  // rest of the repo's commands are documented, as well as a plain export.
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, from: 'process.env.DATABASE_URL' };

  const dotenv = join(ROOT, '.env');
  if (existsSync(dotenv)) {
    const parsed = parseEnvFile(readFileSync(dotenv, 'utf8'));
    if (parsed.DATABASE_URL) return { url: parsed.DATABASE_URL, from: '.env' };
  }

  throw new Error(
    'No DATABASE_URL. Pass --database-url=<url>, --env-file=<path>, or set it in the ' +
      `environment.\n\n${USAGE}`,
  );
}

/** Host only, so a password never reaches the terminal or a CI log. */
export function describeTarget(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable connection string)';
  }
}

export function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const FIELDS = ['name', 'municipio', 'category', 'subtype', 'difficulty', 'source', 'geoid'];

/**
 * Compare the rows a database currently holds against the rows the files
 * describe.
 *
 * Coordinates are compared as numbers with an epsilon, never as strings: the
 * columns are double precision, the driver may hand back either representation,
 * and `18.4692 !== '18.4692'` would report all 1088 rows as changed.
 *
 * @param {object[]} local   from loadSeedData()
 * @param {object[]} remote  rows of SELECT_LOCATIONS
 */
export function diffLocations(local, remote) {
  const byId = new Map(remote.map((r) => [Number(r.id), r]));
  const added = [];
  const moved = [];
  const changed = [];

  for (const l of local) {
    const r = byId.get(l.id);
    if (!r) {
      added.push(l);
      continue;
    }

    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (Math.abs(lat - l.lat) > 1e-9 || Math.abs(lng - l.lng) > 1e-9) {
      moved.push({ location: l, from: { lat, lng }, km: haversineKm({ lat, lng }, l) });
    }

    const fields = FIELDS.filter((f) => (r[f] ?? null) !== (l[f] ?? null));
    const localRadius = l.radiusKm ?? null;
    const remoteRadius = r.radius_km == null ? null : Number(r.radius_km);
    if (localRadius !== remoteRadius) fields.push('radiusKm');
    if (fields.length > 0) changed.push({ location: l, fields });
  }

  // The seed never deletes -- puzzle_round.location_id references these rows,
  // so removing one is a deliberate manual operation. Surface them as info.
  const localIds = new Set(local.map((l) => l.id));
  const orphaned = remote.filter((r) => !localIds.has(Number(r.id)));

  return { added, moved, changed, orphaned };
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function rows(sql) {
  // The Neon HTTP driver throws a deep stack on a bad host or a rejected
  // password. This is a runbook tool, so surface the one line that says which.
  try {
    const result = await sql.query(SELECT_LOCATIONS);
    return Array.isArray(result) ? result : result.rows;
  } catch (error) {
    throw new Error(`Could not read the location table: ${error.message}`, { cause: error });
  }
}

async function main() {
  let opts;
  let target;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(USAGE);
      return;
    }
    target = resolveDatabaseUrl(opts);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  // Validate the files BEFORE opening a connection, so a malformed edit fails
  // in under a second and never leaves a half-applied batch behind.
  const data = loadSeedData();
  assertSeedInvariants(data);

  console.log(`Target:  ${describeTarget(target.url)}  (from ${target.from})`);
  console.log(`Local:   ${data.locations.length} locations, ${Object.keys(data.shapes).length} shapes`);

  if (!/-pooler\./.test(target.url)) {
    console.log('');
    console.log('WARNING: this does not look like a pooled Neon endpoint (no "-pooler" in the');
    console.log('         host). See README section 1 -- the unpooled endpoint exhausts its');
    console.log('         connection limit under real traffic.');
  }

  const sql = neon(target.url);
  const before = await rows(sql);
  console.log(`Remote:  ${before.length} locations`);
  console.log('');

  const { added, moved, changed, orphaned } = diffLocations(data.locations, before);

  if (moved.length > 0) {
    console.log(`Coordinate changes (${moved.length}):`);
    for (const m of [...moved].sort((a, b) => b.km - a.km)) {
      console.log(
        `  ${String(m.location.id).padStart(4)}  ${m.location.name.padEnd(38)} ` +
          `${m.from.lat},${m.from.lng}  ->  ${m.location.lat},${m.location.lng}  ` +
          `(${m.km.toFixed(3)} km)`,
      );
    }
    console.log('');
  }

  const fieldOnly = changed.filter((c) => !moved.some((m) => m.location.id === c.location.id));
  if (fieldOnly.length > 0) {
    console.log(`Other field changes (${fieldOnly.length}):`);
    for (const c of fieldOnly) {
      console.log(
        `  ${String(c.location.id).padStart(4)}  ${c.location.name.padEnd(38)} ${c.fields.join(', ')}`,
      );
    }
    console.log('');
  }

  if (added.length > 0) {
    console.log(`New locations (${added.length}):`);
    for (const l of added.slice(0, 20)) console.log(`  ${String(l.id).padStart(4)}  ${l.name}`);
    if (added.length > 20) console.log(`  ... and ${added.length - 20} more`);
    console.log('');
  }

  if (orphaned.length > 0) {
    console.log(`In the database but not in the files (${orphaned.length}), left untouched:`);
    for (const r of orphaned.slice(0, 20)) console.log(`  ${String(r.id).padStart(4)}  ${r.name}`);
    if (orphaned.length > 20) console.log(`  ... and ${orphaned.length - 20} more`);
    console.log('  Removing a location is manual: puzzle_round.location_id references it.');
    console.log('');
  }

  if (moved.length === 0 && fieldOnly.length === 0 && added.length === 0) {
    console.log('Locations are already in sync. Shapes are not diffed; run npm run db:seed if a');
    console.log('regen changed public/shapes-pr.json.');
    return;
  }

  if (opts.dryRun) {
    console.log('--dry-run: nothing written.');
    return;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.error('Refusing to write without a TTY to confirm on. Pass --yes to proceed.');
      process.exit(1);
    }
    const ok = await confirm(`Apply to ${describeTarget(target.url)}? Type "yes" to continue: `);
    if (!ok) {
      console.log('Aborted; nothing written.');
      process.exit(1);
    }
  }

  // Shapes first: location.geoid is a foreign key to shape.geoid, so a new
  // curated row pointing at a new Census unit needs its shape to exist.
  console.log('');
  console.log('Writing...');
  console.log(`  shapes    ${await seedShapes(sql, data.shapes)} upserted`);
  console.log(`  locations ${await seedLocations(sql, data.locations)} upserted`);

  // Read back rather than trust the write. An upsert that silently matched
  // nothing looks exactly like one that worked.
  const after = await rows(sql);
  const residual = diffLocations(data.locations, after);
  const outstanding = residual.moved.length + residual.changed.length + residual.added.length;

  if (outstanding > 0) {
    console.error('');
    console.error(`FAILED: ${outstanding} row(s) still differ after writing.`);
    process.exit(1);
  }

  console.log('');
  console.log(`In sync: ${after.length} locations match this checkout.`);
}

// Importing this module must never open a connection: sync-locations.test.mjs
// exercises the pure functions above with no database in sight.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    // One readable line by default; SYNC_DEBUG=1 for the stack when the failure
    // is a bug in here rather than a bad connection string.
    console.error(`\n${error.message}`);
    if (process.env.SYNC_DEBUG) console.error(error);
    process.exit(1);
  }
}
