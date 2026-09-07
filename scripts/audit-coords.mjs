#!/usr/bin/env node
// Re-verifies curated landmark coordinates against their recorded sources.
//
//   node scripts/audit-coords.mjs            local checks only, no network
//   node scripts/audit-coords.mjs --live     also re-fetch OSM objects by id
//
// This is a maintenance tool, not part of the build. The invariant it guards
// is asserted offline by src/data/landmark-coords.test.ts; what --live adds is
// detection of drift in the upstream source itself -- an OSM way that has been
// redrawn, retagged or deleted since the reference was recorded.
//
// WHY LOOKUP BY ID, NOT BY NAME
// -----------------------------
// The audit that originally found these six defects searched by name, and both
// obvious ranking strategies produced confident wrong answers:
//
//   rank by distance  -- confirms whatever coordinate is already in the file,
//                        which is precisely how a 4 km error survives review
//   rank by name      -- "Cabo Rojo" matches the MUNICIPALITY (13.6 km away,
//                        and the bad point falls inside its polygon, so the
//                        check reads as a pass); "El Vigía" matches a
//                        same-named building 75 km away
//
// Only a bounding box AND a name filter together resolved the ambiguous cases.
// Storing the resolved object id in landmark-references.ts retires that whole
// problem: re-verification is a direct lookup with nothing left to rank.
//
// Zero dependencies, matching scripts/build-locations.mjs and scripts/seed.mjs.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'maptap-audit-coords (https://github.com/angel1254mc/islatap)';

// Overpass rate-limits aggressively and answers 429 with no body. One batched
// query for every id beats 26 sequential ones and stays inside the free tier.
const OVERPASS_TIMEOUT_MS = 180_000;

/** Slice an exported array literal out of a .ts file. Mirrors scripts/seed.mjs. */
function extractArrayLiteral(source, exportName, typeName) {
  const marker = `export const ${exportName}: ${typeName}[] = [`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`no "export const ${exportName}: ${typeName}[] = [" found`);
  const open = start + marker.length - 1;
  const close = source.lastIndexOf('];');
  if (close < open) throw new Error(`no closing "];" after ${exportName}`);
  return source.slice(open, close + 1);
}

function load(file, exportName, typeName) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  return eval(extractArrayLiteral(text, exportName, typeName));
}

export function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Half the diagonal of an Overpass `bounds`, or 0 for a node. */
function halfDiagonalKm(bounds) {
  if (!bounds) return 0;
  return (
    haversineKm(
      { lat: bounds.minlat, lng: bounds.minlon },
      { lat: bounds.maxlat, lng: bounds.maxlon },
    ) / 2
  );
}

/** Fetch every osm:<type>/<id> reference in one Overpass call. */
async function fetchOsm(references) {
  const wanted = references
    .map((r) => /^osm:(node|way|relation)\/(\d+)$/.exec(r.source))
    .filter(Boolean);
  if (wanted.length === 0) return new Map();

  const body =
    `[out:json][timeout:${Math.floor(OVERPASS_TIMEOUT_MS / 1000)}];(` +
    wanted.map(([, type, id]) => `${type}(${id});`).join('') +
    ');out bb;';

  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: body }),
    signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);

  const out = new Map();
  for (const el of (await res.json()).elements ?? []) {
    // `out bb` gives ways and relations a bounding box and nothing else;
    // nodes carry lat/lon directly. A bbox centre is NOT an area centroid, so
    // this is a drift alarm compared with tolerance, never a source of truth.
    // (`out bb center` would seem tidier but silently drops `bounds`, leaving
    // no way to size the tolerance -- which is how the airport relation came
    // out as a false positive the first time.)
    const b = el.bounds;
    const lat = el.lat ?? (b && (b.minlat + b.maxlat) / 2);
    const lng = el.lon ?? (b && (b.minlon + b.maxlon) / 2);
    if (lat == null) continue;
    out.set(`osm:${el.type}/${el.id}`, { lat, lng, bounds: b ?? null });
  }
  return out;
}

async function main() {
  const live = process.argv.includes('--live');

  const curated = load('src/data/curated.ts', 'CURATED_LOCATIONS', 'GameLocation');
  const references = load('src/data/landmark-references.ts', 'LANDMARK_REFERENCES', 'LandmarkReference');
  const landmarks = curated.filter((l) => l.category === 'landmark');
  const byId = new Map(references.map((r) => [r.id, r]));

  let failures = 0;
  console.log(`Auditing ${landmarks.length} curated landmarks against ${references.length} references.\n`);

  for (const l of landmarks) {
    const ref = byId.get(l.id);
    if (!ref) {
      console.log(`  MISSING REF  ${l.name} (id ${l.id})`);
      failures += 1;
      continue;
    }
    const km = haversineKm(l, ref);
    // radiusKm rows must have the real place inside the acceptance circle.
    // geoid rows score by polygon, so the point only aims the reveal camera.
    const limit = l.radiusKm ?? 5;
    const bad = km > limit;
    if (bad) failures += 1;
    console.log(
      `  ${bad ? 'FAIL' : 'ok  '}  ${l.name.padEnd(38)} ${km.toFixed(3).padStart(8)} km  ` +
        `limit ${String(limit).padStart(4)}  ${ref.source}`,
    );
  }

  if (live) {
    console.log('\nRe-fetching OSM sources by id...');
    const fetched = await fetchOsm(references);
    for (const ref of references) {
      if (!ref.source.startsWith('osm:')) continue;
      const upstream = fetched.get(ref.source);
      if (!upstream) {
        console.log(`  GONE  ${ref.name.padEnd(38)} ${ref.source} not returned by Overpass`);
        failures += 1;
        continue;
      }
      const drift = haversineKm(ref, upstream);
      // Tolerance scales with the object's own size. `out center` returns a
      // BOUNDING-BOX centre, not an area centroid, so the two disagree by more
      // the larger and less symmetric the object is -- a 0.5 km fixed limit
      // flags the airport relation (0.52 km) while a redrawn small building
      // would slip under it. Half the bbox diagonal is the most a bbox centre
      // can sit from any point inside, which is the honest bound here.
      const tolerance = Math.max(0.5, halfDiagonalKm(upstream.bounds));
      if (drift > tolerance) {
        console.log(
          `  DRIFT ${ref.name.padEnd(38)} ${drift.toFixed(3)} km from ${ref.source} ` +
            `(tolerance ${tolerance.toFixed(3)} km)`,
        );
        failures += 1;
      }
    }
    console.log('  GNIS references are a static federal dataset; re-check them against');
    console.log('  https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_PR_Text.zip');
  }

  console.log(failures === 0 ? '\nAll landmarks agree with their sources.' : `\n${failures} problem(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
