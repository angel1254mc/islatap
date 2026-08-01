// Generates src/data/tiger.generated.ts from U.S. Census TIGER/Line 2022 shapefiles.
//
//   node scripts/build-locations.mjs
//
// Sources (public domain / CC0, no key or attribution required):
//   COUSUB — tl_2022_72_cousub.zip  → barrios (the real barrio layer; PLACE has none)
//   PLACE  — tl_2022_72_place.zip   → comunidades (LSAD 55 CDPs)
//
// Deliberately NOT ingested, see README notes:
//   PLACE "zona urbana" (LSAD 62) — its INTPTLAT/LON is a guaranteed-inside-polygon
//     point, not a town plaza; it sits 8.2 km from Old San Juan. The curated GeoNames
//     municipio seats in curated.ts are better game answers.
//   POINTLM / AREALM — only 161/1120 and 278/345 records are even named, and the names
//     are mangled abbreviations ("Hosp de Veteranos"). Landmarks stay curated.
//
// Zero dependencies: zip, .dbf and .shp are parsed inline below.

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.tiger-cache');
const OUT = join(ROOT, 'src', 'data', 'tiger.generated.ts');

const BASE = 'https://www2.census.gov/geo/tiger/TIGER2022';
const SOURCES = {
  cousub: `${BASE}/COUSUB/tl_2022_72_cousub.zip`,
  place: `${BASE}/PLACE/tl_2022_72_place.zip`,
};

// Boundary SHAPES come from the cartographic-boundary files, NOT TIGER/Line.
// TIGER ships legal boundaries: coastal units include territorial water (Isabela's
// county polygon reached ~5.7 km into the Atlantic; Torrecilla Baja in Loíza is 37%
// water). The cb_*_500k files are the same units clipped to the shoreline — and the
// county file is 11 MB instead of TIGER's 80 MB.
const CB_BASE = 'https://www2.census.gov/geo/tiger/GENZ2022/shp';
const CB_SOURCES = {
  county: `${CB_BASE}/cb_2022_us_county_500k.zip`,
  cousub: `${CB_BASE}/cb_2022_72_cousub_500k.zip`,
  place: `${CB_BASE}/cb_2022_72_place_500k.zip`,
  subbarrio: `${CB_BASE}/cb_2022_72_subbarrio_500k.zip`,
};
const SHAPES_OUT = join(ROOT, 'public', 'shapes-pr.json');

// Every municipio has a barrio-pueblo named after it, so including them would emit 74
// near-duplicates of the municipio rounds ("Cabo Rojo" the pueblo vs "Cabo Rojo" the
// municipio, ~250 m apart). Flip to true if you want them as their own prompts.
const INCLUDE_BARRIO_PUEBLO = false;

// COUNTYFP -> municipio, extracted from TIGER2022 tl_2022_us_county (STATEFP 72).
// Inlined because the only national county file is an ~80 MB download for 78 strings.
const MUNICIPIOS = {
  '001': 'Adjuntas', '003': 'Aguada', '005': 'Aguadilla', '007': 'Aguas Buenas',
  '009': 'Aibonito', '011': 'Añasco', '013': 'Arecibo', '015': 'Arroyo',
  '017': 'Barceloneta', '019': 'Barranquitas', '021': 'Bayamón', '023': 'Cabo Rojo',
  '025': 'Caguas', '027': 'Camuy', '029': 'Canóvanas', '031': 'Carolina',
  '033': 'Cataño', '035': 'Cayey', '037': 'Ceiba', '039': 'Ciales',
  '041': 'Cidra', '043': 'Coamo', '045': 'Comerío', '047': 'Corozal',
  '049': 'Culebra', '051': 'Dorado', '053': 'Fajardo', '054': 'Florida',
  '055': 'Guánica', '057': 'Guayama', '059': 'Guayanilla', '061': 'Guaynabo',
  '063': 'Gurabo', '065': 'Hatillo', '067': 'Hormigueros', '069': 'Humacao',
  '071': 'Isabela', '073': 'Jayuya', '075': 'Juana Díaz', '077': 'Juncos',
  '079': 'Lajas', '081': 'Lares', '083': 'Las Marías', '085': 'Las Piedras',
  '087': 'Loíza', '089': 'Luquillo', '091': 'Manatí', '093': 'Maricao',
  '095': 'Maunabo', '097': 'Mayagüez', '099': 'Moca', '101': 'Morovis',
  '103': 'Naguabo', '105': 'Naranjito', '107': 'Orocovis', '109': 'Patillas',
  '111': 'Peñuelas', '113': 'Ponce', '115': 'Quebradillas', '117': 'Rincón',
  '119': 'Río Grande', '121': 'Sabana Grande', '123': 'Salinas', '125': 'San Germán',
  '127': 'San Juan', '129': 'San Lorenzo', '131': 'San Sebastián', '133': 'Santa Isabel',
  '135': 'Toa Alta', '137': 'Toa Baja', '139': 'Trujillo Alto', '141': 'Utuado',
  '143': 'Vega Alta', '145': 'Vega Baja', '147': 'Vieques', '149': 'Villalba',
  '151': 'Yabucoa', '153': 'Yauco',
};

// ---------------------------------------------------------------- zip

/** Extract every member of a zip buffer into a Map<name, Buffer>. */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name/extra with its own lengths — trust those.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------- dbf

/** Parse a dBASE III .dbf into an array of plain string-valued objects. */
function readDbf(buf) {
  const recordCount = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);

  const fields = [];
  for (let p = 32; buf[p] !== 0x0d && p < headerLen; p += 32) {
    let end = 0;
    while (end < 11 && buf[p + end] !== 0) end++;
    fields.push({ name: buf.toString('latin1', p, p + end), len: buf[p + 16] });
  }

  const rows = [];
  for (let r = 0; r < recordCount; r++) {
    const base = headerLen + r * recordLen;
    if (buf[base] === 0x2a) continue; // tombstoned record
    let p = base + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = buf.toString('utf8', p, p + f.len).trim();
      p += f.len;
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- shp

/**
 * Parse polygon geometry from a .shp, in record order (which matches .dbf row order).
 * Returns one entry per record: { bbox: [minX,minY,maxX,maxY], rings: number[][][] }.
 */
function readPolygons(buf) {
  const shapes = [];
  let p = 100; // skip the 100-byte file header
  while (p + 8 <= buf.length) {
    const contentWords = buf.readInt32BE(p + 4);
    const content = p + 8;
    const type = buf.readInt32LE(content);

    if (type === 5) { // Polygon
      const bbox = [
        buf.readDoubleLE(content + 4), buf.readDoubleLE(content + 12),
        buf.readDoubleLE(content + 20), buf.readDoubleLE(content + 28),
      ];
      const numParts = buf.readInt32LE(content + 36);
      const numPoints = buf.readInt32LE(content + 40);
      const partsAt = content + 44;
      const pointsAt = partsAt + numParts * 4;

      const starts = [];
      for (let i = 0; i < numParts; i++) starts.push(buf.readInt32LE(partsAt + i * 4));

      const rings = [];
      for (let i = 0; i < numParts; i++) {
        const from = starts[i];
        const to = i + 1 < numParts ? starts[i + 1] : numPoints;
        const ring = [];
        for (let j = from; j < to; j++) {
          ring.push([
            buf.readDoubleLE(pointsAt + j * 16),
            buf.readDoubleLE(pointsAt + j * 16 + 8),
          ]);
        }
        rings.push(ring);
      }
      shapes.push({ bbox, rings });
    } else {
      shapes.push(null); // null shape / unsupported type — keeps indices aligned
    }
    p = content + contentWords * 2;
  }
  return shapes;
}

/** Even-odd ray casting across all rings (correctly excludes holes). */
function pointInShape(shape, x, y) {
  if (!shape) return false;
  const [minX, minY, maxX, maxY] = shape.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;

  let inside = false;
  for (const ring of shape.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// ------------------------------------------------------- shape emission

// No extra simplification: the cb_*_500k inputs are already generalized by Census
// AS A LAYER, so adjacent units share identical border vertices. Running our own
// per-polygon Douglas\u2013Peucker here (as an earlier revision did) simplified each
// polygon independently and broke that coincidence \u2014 neighboring barrios kept
// different vertices along the same border, leaving ~60 m slivers visible when
// shapes are overlaid (e.g. the ?debug=shapes view). Identical rounding of
// identical source coordinates preserves shared edges exactly.
const COORD_DECIMALS = 5; // ~1 m

/** Shoelace area; positive = counter-clockwise in the lng/lat plane. */
function shoelace(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

function pointInRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** One [lng,lat] ring \u2192 rounded, deduped [lat,lng] ring (or null if collapsed). */
function toOutputRing(ring) {
  const out = [];
  for (const [lng, lat] of ring) {
    const p = [Number(lat.toFixed(COORD_DECIMALS)), Number(lng.toFixed(COORD_DECIMALS))];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  // Re-close if rounding merged the closing duplicate away.
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length >= 3 && (first[0] !== last[0] || first[1] !== last[1])) out.push([first[0], first[1]]);
  return out.length >= 4 ? out : null;
}

/**
 * Shapefile record \u2192 MultiPolygon ([lat,lng], parts \u2192 [outer, ...holes]).
 * Shapefile winding: clockwise = outer (negative shoelace), counter-clockwise = hole.
 */
function shapeToMultiPolygon(shape) {
  if (!shape) return null;
  const outers = [];
  const holes = [];
  for (const ring of shape.rings) {
    (shoelace(ring) < 0 ? outers : holes).push(ring);
  }
  if (outers.length === 0) return null;
  const grouped = outers.map((outer) => [outer]);
  for (const hole of holes) {
    const idx = outers.findIndex((outer) => pointInRing(hole[0], outer));
    if (idx >= 0) grouped[idx].push(hole); // orphan holes are degenerate data \u2014 dropped
  }
  const parts = [];
  for (const rings of grouped) {
    const outer = toOutputRing(rings[0]);
    if (!outer) continue; // outer collapsed \u2192 its holes go with it
    const part = [outer];
    for (const hole of rings.slice(1)) {
      const simplifiedHole = toOutputRing(hole);
      if (simplifiedHole) part.push(simplifiedHole);
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts : null;
}

// ---------------------------------------------------------------- helpers

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function fetchCached(name, url) {
  const path = join(CACHE, name);
  if (existsSync(path)) return readFile(path);
  process.stdout.write(`  downloading ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, buf);
  return buf;
}

// ---------------------------------------------------------------- build

console.log('Reading TIGER/Line 2022 sources…');
const cousubZip = unzip(await fetchCached('cousub.zip', SOURCES.cousub));
const placeZip = unzip(await fetchCached('place.zip', SOURCES.place));

const cousubRows = readDbf(cousubZip.get('tl_2022_72_cousub.dbf'));
const cousubShapes = readPolygons(cousubZip.get('tl_2022_72_cousub.shp'));
const placeRows = readDbf(placeZip.get('tl_2022_72_place.dbf'));

if (cousubRows.length !== cousubShapes.length) {
  throw new Error(`cousub .dbf/.shp record mismatch: ${cousubRows.length} vs ${cousubShapes.length}`);
}

// Barrios. CLASSFP Z9 is the 38 "Municipio subdivision not defined" water placeholders.
const barrioRows = cousubRows
  .map((row, i) => ({ row, shape: cousubShapes[i] }))
  .filter(({ row }) => row.CLASSFP !== 'Z9' && Number(row.ALAND) > 0);

const kept = barrioRows.filter(({ row }) =>
  row.LSAD === '20' || (INCLUDE_BARRIO_PUEBLO && row.LSAD === '41'));

// Comunidades (CDPs). PLACE carries no COUNTYFP, so resolve the municipio by locating
// each internal point inside the barrio polygons we just parsed.
const comunidadRows = placeRows.filter((r) => r.LSAD === '55');
let unresolved = 0;

const comunidades = comunidadRows.map((row) => {
  const lat = parseFloat(row.INTPTLAT);
  const lng = parseFloat(row.INTPTLON);
  const hit = barrioRows.find(({ shape }) => pointInShape(shape, lng, lat));
  if (!hit) unresolved++;
  return {
    row,
    lat,
    lng,
    municipio: hit ? MUNICIPIOS[hit.row.COUNTYFP] : null,
  };
});

// Difficulty: land area is the only signal TIGER gives us. Nothing generated is ever
// 'easy' — that tier stays reserved for the curated landmarks and metro municipios.
const areas = [...kept.map(({ row }) => Number(row.ALAND)),
               ...comunidades.map((c) => Number(c.row.ALAND))].sort((a, b) => a - b);
const p75 = areas[Math.floor(areas.length * 0.75)];
const difficultyFor = (aland) => (Number(aland) >= p75 ? 'medium' : 'hard');

const entries = [
  ...kept.map(({ row }) => ({
    name: row.NAME,
    municipio: MUNICIPIOS[row.COUNTYFP] ?? null,
    subtype: row.LSAD === '41' ? 'barrio-pueblo' : 'barrio',
    source: 'tiger-cousub',
    geoid: row.GEOID,
    lat: parseFloat(row.INTPTLAT),
    lng: parseFloat(row.INTPTLON),
    aland: Number(row.ALAND),
  })),
  ...comunidades.map((c) => ({
    name: c.row.NAME,
    municipio: c.municipio,
    subtype: 'comunidad',
    source: 'tiger-place',
    geoid: c.row.GEOID,
    lat: c.lat,
    lng: c.lng,
    aland: Number(c.row.ALAND),
  })),
];

// Dedup on folded name + municipio, which is exactly what the player sees. Two rows
// that render identically are an unanswerable prompt no matter how distinct their
// Census identities are — 79 comunidades share a name with a barrio in the same
// municipio (Aceitunas is both a barrio and a comunidad in Moca).
//
// Preference order: curated beats barrio beats comunidad. Curated coordinates are
// hand-verified; a barrio is the canonical named unit and the larger tap target,
// and the overlapping comunidad sits inside it anyway.
const curatedSrc = await readFile(join(ROOT, 'src', 'data', 'curated.ts'), 'utf8');
const taken = new Set();
for (const m of curatedSrc.matchAll(/name:\s*'((?:[^'\\]|\\.)*)'[^}]*?municipio:\s*(?:'((?:[^'\\]|\\.)*)'|null)/g)) {
  taken.add(`${fold(m[1].replace(/\\'/g, "'"))}|${m[2] ? fold(m[2].replace(/\\'/g, "'")) : ''}`);
}
// A curated row can also duplicate a generated row's *shape* while using a different
// display name — e.g. curated 'Viejo San Juan' (7212776812) is the same polygon as
// generated 'San Juan Antiguo', and curated 'Playa de Ponce' (7211362751) is the same
// polygon as generated 'Playa, Ponce'. The name+municipio key above misses these, so
// dedup on curated geoid too.
const curatedGeoids = new Set();
for (const m of curatedSrc.matchAll(/geoid:\s*'(\d+)'/g)) {
  curatedGeoids.add(m[1]);
}

const RANK = { barrio: 0, 'barrio-pueblo': 1, comunidad: 2 };
const dropCounts = {};
const deduped = [];
for (const e of [...entries].sort((a, b) => RANK[a.subtype] - RANK[b.subtype])) {
  const key = `${fold(e.name)}|${fold(e.municipio ?? '')}`;
  if (taken.has(key) || curatedGeoids.has(e.geoid)) {
    dropCounts[e.subtype] = (dropCounts[e.subtype] ?? 0) + 1;
    continue;
  }
  taken.add(key);
  deduped.push(e);
}
const dropped = entries.length - deduped.length;

// Stable ids: sort deterministically, then number from 1000 so curated 1-999 stay free.
deduped.sort((a, b) =>
  (a.municipio ?? '').localeCompare(b.municipio ?? '', 'es') ||
  a.name.localeCompare(b.name, 'es') ||
  a.geoid.localeCompare(b.geoid));

const rows = deduped.map((e, i) => {
  const municipio = e.municipio ? quote(e.municipio) : 'null';
  return `  { id: ${1000 + i}, name: ${quote(e.name)}, municipio: ${municipio}, ` +
    `category: 'barrio', subtype: '${e.subtype}', difficulty: '${difficultyFor(e.aland)}', ` +
    `source: '${e.source}', geoid: '${e.geoid}', lat: ${e.lat}, lng: ${e.lng} },`;
});

const counts = deduped.reduce((acc, e) => ({ ...acc, [e.subtype]: (acc[e.subtype] ?? 0) + 1 }), {});
const checksum = createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 12);

const file = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: node scripts/build-locations.mjs
//
// Source: U.S. Census Bureau TIGER/Line 2022, Puerto Rico (STATEFP 72). Public domain (CC0).
//   barrios      <- COUSUB tl_2022_72_cousub (LSAD 20)
//   comunidades  <- PLACE  tl_2022_72_place  (LSAD 55)
//
// Coordinates are the Census INTPTLAT/INTPTLON internal point: a point guaranteed to
// fall inside the polygon. It is NOT a population-weighted centroid or a town plaza.
//
// Names collide heavily across municipios (Quebrada Arenas exists 6 times), so every
// row carries \`municipio\` and the UI must render it via displayName().
//
// ${deduped.length} entries — ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}
// checksum ${checksum}
import type { GameLocation } from './types';

export const TIGER_LOCATIONS: GameLocation[] = [
${rows.join('\n')}
];
`;

await writeFile(OUT, file, 'utf8');

console.log(`
  barrios kept        ${kept.length}${INCLUDE_BARRIO_PUEBLO ? '' : `  (excluded ${barrioRows.length - kept.length} barrio-pueblo)`}
  comunidades         ${comunidades.length}${unresolved ? `  (${unresolved} unresolved municipio)` : ''}
  deduped             ${dropped}  (${Object.entries(dropCounts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'})
  written             ${deduped.length} -> src/data/tiger.generated.ts
  area p75            ${(p75 / 1e6).toFixed(2)} km² (>= is 'medium', below is 'hard')
`);

// ---------------------------------------------------------------- shapes-pr.json

console.log('Emitting shapes (cartographic boundaries, shoreline-clipped)…');

/** Load a cb_* layer: parallel arrays of dbf rows and parsed polygon records. */
async function loadCbLayer(cacheName, url) {
  const zip = unzip(await fetchCached(cacheName, url));
  const stem = [...zip.keys()].find((n) => n.endsWith('.shp')).slice(0, -4);
  const rows = readDbf(zip.get(`${stem}.dbf`));
  const shapes = readPolygons(zip.get(`${stem}.shp`));
  if (rows.length !== shapes.length) {
    throw new Error(`${cacheName} .dbf/.shp record mismatch: ${rows.length} vs ${shapes.length}`);
  }
  return { rows, shapes };
}

const cbCounty = await loadCbLayer('cb-county.zip', CB_SOURCES.county);
const cbCousub = await loadCbLayer('cb-cousub.zip', CB_SOURCES.cousub);
const cbPlace = await loadCbLayer('cb-place.zip', CB_SOURCES.place);
const cbSubbarrio = await loadCbLayer('cb-subbarrio.zip', CB_SOURCES.subbarrio);

const shapesOut = {};
let skipped = 0;
const emitShape = (geoid, shape) => {
  const multi = shapeToMultiPolygon(shape);
  if (multi) shapesOut[geoid] = multi;
  else skipped++;
};

cbCounty.rows.forEach((row, i) => {
  if (row.STATEFP === '72') emitShape(row.GEOID, cbCounty.shapes[i]);
});
for (const layer of [cbCousub, cbPlace, cbSubbarrio]) {
  layer.rows.forEach((row, i) => emitShape(row.GEOID, layer.shapes[i]));
}

const shapesJson = JSON.stringify(shapesOut);
await writeFile(SHAPES_OUT, shapesJson, 'utf8');
console.log(`
  shapes emitted      ${Object.keys(shapesOut).length}${skipped ? `  (${skipped} degenerate skipped)` : ''}
  shapes-pr.json      ${(shapesJson.length / 1024 / 1024).toFixed(2)} MB -> public/shapes-pr.json
`);
