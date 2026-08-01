# Barrio Shapes on Reveal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a guess, draw the target's real Census boundary on the map and score fairly against it: inside the polygon = 5,000 points, outside = existing decay curve applied to distance-to-nearest-edge.

**Architecture:** `scripts/build-locations.mjs` gains two TIGER layers (COUNTY, SUBBARRIO) and emits simplified polygon geometry to `public/shapes-pr.json`, keyed by Census GEOID. The client fetches that file once in the background (`src/lib/shapes.ts`, sole API `getShape(geoid)`); geometry math lives in `src/lib/scoring.ts`; `App.tsx` prefers shape distance when a shape is available and falls back to today's point distance otherwise.

**Tech Stack:** React + Vite + TypeScript, react-leaflet, vitest. Build script is plain Node with **zero dependencies** (zip/dbf/shp parsed inline, Douglas–Peucker implemented inline).

**Spec:** `docs/superpowers/specs/2026-07-31-barrio-shapes-design.md`

## Global Constraints

- No new npm dependencies, anywhere.
- Generated artifacts are committed: `src/data/tiger.generated.ts`, `public/shapes-pr.json`. Never hand-edit them.
- `scripts/.tiger-cache/` is gitignored; the COUNTY zip (~80 MB) downloads once into it.
- Exact UI strings: inside verdict is `¡Adentro!`; guess tooltip when outside stays `Tu toque`.
- Shape color `#2dd4a7` (existing target green), weight 2, fillOpacity 0.15.
- `public/shapes-pr.json` must stay under **3.5 MB** (dataset test enforces).
- Scoring and rendering must use the same simplified geometry — never score against full-resolution rings.
- All commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Run commands from repo root `C:\Users\angel\maptap-pr` (PowerShell).

---

### Task 1: Shape geometry in `src/lib/scoring.ts`

**Files:**
- Modify: `src/lib/scoring.ts` (append after `formatDistance`)
- Test: `src/lib/shape-scoring.test.ts` (create)

**Interfaces:**
- Consumes: existing `LatLng`, `scoreForDistance` from `scoring.ts`.
- Produces (later tasks rely on these exact names):
  - `export type LatLngTuple = [number, number]` — `[lat, lng]`
  - `export type Ring = LatLngTuple[]`
  - `export type MultiPolygon = Ring[][]` — polygon parts → rings; ring 0 outer, rest holes
  - `export function pointInMultiPolygon(point: LatLng, shape: MultiPolygon): boolean`
  - `export function nearestPointOnShape(point: LatLng, shape: MultiPolygon): { point: LatLng; distanceKm: number }`
  - `export function distanceToShapeKm(point: LatLng, shape: MultiPolygon): number` — 0 when inside

- [ ] **Step 1: Write the failing test**

Create `src/lib/shape-scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  distanceToShapeKm,
  nearestPointOnShape,
  pointInMultiPolygon,
  scoreForDistance,
  type MultiPolygon,
} from './scoring';

// 0.1° square in southwest PR: lat 18.0–18.1, lng -66.5–-66.4.
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

// Same square with a centered hole: lat 18.02–18.08, lng -66.48–-66.42.
const DONUT: MultiPolygon = [
  [
    SQUARE[0][0],
    [
      [18.02, -66.48],
      [18.02, -66.42],
      [18.08, -66.42],
      [18.08, -66.48],
      [18.02, -66.48],
    ],
  ],
];

// Two separate squares (multipolygon): SQUARE plus a far one near Vieques.
const TWO_PARTS: MultiPolygon = [
  SQUARE[0],
  [
    [
      [18.1, -65.5],
      [18.1, -65.4],
      [18.2, -65.4],
      [18.2, -65.5],
      [18.1, -65.5],
    ],
  ],
];

describe('pointInMultiPolygon', () => {
  it('detects a point inside', () => {
    expect(pointInMultiPolygon({ lat: 18.05, lng: -66.45 }, SQUARE)).toBe(true);
  });

  it('detects a point outside', () => {
    expect(pointInMultiPolygon({ lat: 17.95, lng: -66.45 }, SQUARE)).toBe(false);
  });

  it('treats a point in a hole as outside', () => {
    expect(pointInMultiPolygon({ lat: 18.05, lng: -66.45 }, DONUT)).toBe(false);
  });

  it('still detects the ring of a donut', () => {
    // Between outer (18.0) and hole (18.02).
    expect(pointInMultiPolygon({ lat: 18.01, lng: -66.45 }, DONUT)).toBe(true);
  });

  it('checks every part of a multipolygon', () => {
    expect(pointInMultiPolygon({ lat: 18.15, lng: -65.45 }, TWO_PARTS)).toBe(true);
  });
});

describe('distanceToShapeKm', () => {
  it('returns 0 inside', () => {
    expect(distanceToShapeKm({ lat: 18.05, lng: -66.45 }, SQUARE)).toBe(0);
  });

  it('measures to the nearest edge outside', () => {
    // 0.05° of latitude south of the bottom edge ≈ 5.57 km.
    const d = distanceToShapeKm({ lat: 17.95, lng: -66.45 }, SQUARE);
    expect(d).toBeCloseTo(5.57, 1);
  });

  it('measures to the hole edge from within a hole', () => {
    // Center of the hole; nearest edge is the hole's lng wall ≈ 3.2 km.
    const d = distanceToShapeKm({ lat: 18.05, lng: -66.45 }, DONUT);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(3.5);
  });

  it('uses the nearest part of a multipolygon', () => {
    // Just east of the second square, far from the first.
    const d = distanceToShapeKm({ lat: 18.15, lng: -65.39 }, TWO_PARTS);
    expect(d).toBeLessThan(1.5);
  });

  it('feeds the existing curve so inside scores 5000', () => {
    expect(scoreForDistance(distanceToShapeKm({ lat: 18.05, lng: -66.45 }, SQUARE))).toBe(5000);
  });
});

describe('nearestPointOnShape', () => {
  it('projects onto the closest edge', () => {
    const { point, distanceKm } = nearestPointOnShape({ lat: 17.95, lng: -66.45 }, SQUARE);
    expect(point.lat).toBeCloseTo(18.0, 5);
    expect(point.lng).toBeCloseTo(-66.45, 5);
    expect(distanceKm).toBeCloseTo(5.57, 1);
  });

  it('clamps to a vertex when beyond the segment end', () => {
    const { point } = nearestPointOnShape({ lat: 17.9, lng: -66.6 }, SQUARE);
    expect(point.lat).toBeCloseTo(18.0, 5);
    expect(point.lng).toBeCloseTo(-66.5, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/shape-scoring.test.ts`
Expected: FAIL — `pointInMultiPolygon` etc. have no exported member.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/scoring.ts`:

```ts
// ---------------------------------------------------------------- shapes

/** [lat, lng] pair — matches Leaflet's LatLngTuple ordering. */
export type LatLngTuple = [number, number];
export type Ring = LatLngTuple[];
/** Polygon parts → rings; within a part, ring 0 is the outer ring, the rest are holes. */
export type MultiPolygon = Ring[][];

/** Kilometers per degree of latitude (and of longitude at the equator). */
const KM_PER_DEG = 111.32;

/** Even-odd ray cast across every ring; holes count out, parts count in. */
export function pointInMultiPolygon(point: LatLng, shape: MultiPolygon): boolean {
  let inside = false;
  for (const part of shape) {
    for (const ring of part) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [latI, lngI] = ring[i];
        const [latJ, lngJ] = ring[j];
        if (
          latI > point.lat !== latJ > point.lat &&
          point.lng < ((lngJ - lngI) * (point.lat - latI)) / (latJ - latI) + lngI
        ) {
          inside = !inside;
        }
      }
    }
  }
  return inside;
}

/**
 * Nearest point on a segment in a local equirectangular plane. Adequate at
 * Puerto Rico scale (< 0.1% error) and, unlike haversine-per-vertex, gives
 * the projected point back for drawing.
 */
function segmentNearest(
  point: LatLng,
  a: LatLngTuple,
  b: LatLngTuple,
): { distanceKm: number; at: LatLng } {
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const ax = a[1] * cosLat;
  const ay = a[0];
  const bx = b[1] * cosLat;
  const by = b[0];
  const px = point.lng * cosLat;
  const py = point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const distanceKm = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * KM_PER_DEG;
  return {
    distanceKm,
    at: { lat: a[0] + t * (b[0] - a[0]), lng: a[1] + t * (b[1] - a[1]) },
  };
}

/** Closest boundary point across all rings (holes included — their edge is a border too). */
export function nearestPointOnShape(
  point: LatLng,
  shape: MultiPolygon,
): { point: LatLng; distanceKm: number } {
  let best: { point: LatLng; distanceKm: number } = { point, distanceKm: Infinity };
  for (const part of shape) {
    for (const ring of part) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const candidate = segmentNearest(point, ring[j], ring[i]);
        if (candidate.distanceKm < best.distanceKm) {
          best = { point: candidate.at, distanceKm: candidate.distanceKm };
        }
      }
    }
  }
  return best;
}

/** 0 inside the shape, otherwise distance to the nearest boundary, in km. */
export function distanceToShapeKm(point: LatLng, shape: MultiPolygon): number {
  if (pointInMultiPolygon(point, shape)) return 0;
  return nearestPointOnShape(point, shape).distanceKm;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/shape-scoring.test.ts`
Expected: PASS (all). Then run the full suite: `npm test -- --run` — everything still green.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/scoring.ts src/lib/shape-scoring.test.ts
git commit -m @'
Add polygon geometry helpers to scoring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Emit `public/shapes-pr.json` from the build script

**Files:**
- Modify: `scripts/build-locations.mjs`
- Create (generated): `public/shapes-pr.json`
- Test: `src/data/shapes-dataset.test.ts` (create)

**Interfaces:**
- Consumes: existing script internals — `unzip`, `readDbf`, `readPolygons` (returns `{bbox, rings}` with rings as `[lng, lat]` pairs in shapefile order), `fetchCached`, `barrioRows` (array of `{row, shape}` for non-Z9 COUSUB rows), `placeRows`, `placeZip`, `SOURCES`, `ROOT`.
- Produces: `public/shapes-pr.json` — JSON object `{ [geoid: string]: MultiPolygon }` where `MultiPolygon = [lat,lng][][][]` (parts → rings → points; ring 0 outer). Contains: 78 PR counties (5-digit geoids), all non-Z9 COUSUB units (10-digit), all LSAD-55 places (7-digit), all 145 subbarrios (15-digit).

- [ ] **Step 1: Write the failing dataset test**

Create `src/data/shapes-dataset.test.ts`:

```ts
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from '../lib/scoring';
import { LOCATIONS } from './locations';

const SHAPES_PATH = fileURLToPath(new URL('../../public/shapes-pr.json', import.meta.url));

function loadShapes(): Record<string, MultiPolygon> {
  return JSON.parse(readFileSync(SHAPES_PATH, 'utf8'));
}

describe('public/shapes-pr.json', () => {
  it('has a shape for every location that declares a geoid', () => {
    const shapes = loadShapes();
    const missing = LOCATIONS.filter((l) => l.geoid && !shapes[l.geoid]).map(
      (l) => `${l.name} (${l.geoid})`,
    );
    expect(missing).toEqual([]);
  });

  it('keeps every shape inside greater Puerto Rico bounds', () => {
    // Generous: includes territorial water in county polygons, Mona, Desecheo, Culebra cays.
    const shapes = loadShapes();
    const strays: string[] = [];
    for (const [geoid, shape] of Object.entries(shapes)) {
      for (const part of shape) {
        for (const ring of part) {
          for (const [lat, lng] of ring) {
            if (lat < 17.5 || lat > 18.8 || lng < -68.2 || lng > -64.9) {
              strays.push(geoid);
            }
          }
        }
      }
    }
    expect([...new Set(strays)]).toEqual([]);
  });

  it('has well-formed rings (≥ 4 points, closed)', () => {
    const shapes = loadShapes();
    const bad: string[] = [];
    for (const [geoid, shape] of Object.entries(shapes)) {
      for (const part of shape) {
        for (const ring of part) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (ring.length < 4 || first[0] !== last[0] || first[1] !== last[1]) {
            bad.push(geoid);
          }
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it('contains the three flagship geoids', () => {
    const shapes = loadShapes();
    expect(shapes['72127']).toBeDefined(); // San Juan municipio (county)
    expect(shapes['7212779693']).toBeDefined(); // Santurce barrio (cousub)
    expect(shapes['721277969319927']).toBeDefined(); // Condado subbarrio
  });

  it('stays under the size budget', () => {
    expect(statSync(SHAPES_PATH).size).toBeLessThan(3.5 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/shapes-dataset.test.ts`
Expected: FAIL — `public/shapes-pr.json` does not exist (ENOENT).

- [ ] **Step 3: Extend the build script**

Three edits to `scripts/build-locations.mjs`.

**(a)** Add the new sources and output path. Replace the existing `SOURCES` declaration:

```js
const SOURCES = {
  cousub: `${BASE}/COUSUB/tl_2022_72_cousub.zip`,
  place: `${BASE}/PLACE/tl_2022_72_place.zip`,
  // National file (~80 MB) — only source of county polygons; cached after first run.
  county: `${BASE}/COUNTY/tl_2022_us_county.zip`,
  subbarrio: `${BASE}/SUBBARRIO/tl_2022_72_subbarrio.zip`,
};
const SHAPES_OUT = join(ROOT, 'public', 'shapes-pr.json');
```

**(b)** Add the geometry-emission helpers after the `readPolygons`/`pointInShape` section:

```js
// ------------------------------------------------------- shape emission

// Simplification happens in a locally-scaled plane so tolerance is isotropic.
const LNG_SCALE = Math.cos((18.22 * Math.PI) / 180); // PR mid-latitude
const SIMPLIFY_TOLERANCE_DEG = 0.00055; // ≈ 60 m — invisible at reveal zoom
const COORD_DECIMALS = 5; // ~1 m

function perpendicularDist(p, a, b) {
  const ax = a[0] * LNG_SCALE, ay = a[1];
  const bx = b[0] * LNG_SCALE, by = b[1];
  const px = p[0] * LNG_SCALE, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Classic Douglas–Peucker. Ring endpoints coincide, which degrades the first
 *  split to radial distance from the start point — fine for closed rings. */
function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
  const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
  const right = douglasPeucker(points.slice(maxIdx), tolerance);
  return [...left.slice(0, -1), ...right];
}

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

/** Simplify one [lng,lat] ring → rounded, deduped [lat,lng] ring (or null if collapsed). */
function toOutputRing(ring) {
  const simplified = douglasPeucker(ring, SIMPLIFY_TOLERANCE_DEG);
  const out = [];
  for (const [lng, lat] of simplified) {
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
 * Shapefile record → MultiPolygon ([lat,lng], parts → [outer, ...holes]).
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
    if (idx >= 0) grouped[idx].push(hole); // orphan holes are degenerate data — dropped
  }
  const parts = [];
  for (const rings of grouped) {
    const outer = toOutputRing(rings[0]);
    if (!outer) continue; // outer collapsed → its holes go with it
    const part = [outer];
    for (const hole of rings.slice(1)) {
      const simplifiedHole = toOutputRing(hole);
      if (simplifiedHole) part.push(simplifiedHole);
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts : null;
}
```

**(c)** Emit the file. Add at the end of the script (after the existing `writeFile(OUT, ...)` and its console report):

```js
// ---------------------------------------------------------------- shapes-pr.json

console.log('Emitting shapes…');
const countyZip = unzip(await fetchCached('county.zip', SOURCES.county));
const subbarrioZip = unzip(await fetchCached('subbarrio.zip', SOURCES.subbarrio));

const countyRows = readDbf(countyZip.get('tl_2022_us_county.dbf'));
const countyShapes = readPolygons(countyZip.get('tl_2022_us_county.shp'));
const subbarrioRows = readDbf(subbarrioZip.get('tl_2022_72_subbarrio.dbf'));
const subbarrioShapes = readPolygons(subbarrioZip.get('tl_2022_72_subbarrio.shp'));
const placeShapes = readPolygons(placeZip.get('tl_2022_72_place.shp'));

if (countyRows.length !== countyShapes.length) {
  throw new Error(`county .dbf/.shp record mismatch: ${countyRows.length} vs ${countyShapes.length}`);
}
if (subbarrioRows.length !== subbarrioShapes.length) {
  throw new Error(`subbarrio .dbf/.shp record mismatch: ${subbarrioRows.length} vs ${subbarrioShapes.length}`);
}
if (placeRows.length !== placeShapes.length) {
  throw new Error(`place .dbf/.shp record mismatch: ${placeRows.length} vs ${placeShapes.length}`);
}

const shapesOut = {};
let skipped = 0;
const emitShape = (geoid, shape) => {
  const multi = shapeToMultiPolygon(shape);
  if (multi) shapesOut[geoid] = multi;
  else skipped++;
};

countyRows.forEach((row, i) => {
  if (row.STATEFP === '72') emitShape(row.GEOID, countyShapes[i]);
});
for (const { row, shape } of barrioRows) emitShape(row.GEOID, shape);
placeRows.forEach((row, i) => {
  if (row.LSAD === '55') emitShape(row.GEOID, placeShapes[i]);
});
subbarrioRows.forEach((row, i) => emitShape(row.GEOID, subbarrioShapes[i]));

const shapesJson = JSON.stringify(shapesOut);
await writeFile(SHAPES_OUT, shapesJson, 'utf8');
console.log(`
  shapes emitted      ${Object.keys(shapesOut).length}${skipped ? `  (${skipped} degenerate skipped)` : ''}
  shapes-pr.json      ${(shapesJson.length / 1024 / 1024).toFixed(2)} MB -> public/shapes-pr.json
`);
```

- [ ] **Step 4: Run the script**

Run: `node scripts/build-locations.mjs`
Expected: first run downloads the ~80 MB county zip (give it a couple of minutes), then prints `shapes emitted ~1300+` and a size ≤ ~3 MB. **If the size exceeds 3.4 MB**, raise `SIMPLIFY_TOLERANCE_DEG` to `0.0008` and re-run — do not ship over budget. Also confirm `src/data/tiger.generated.ts` is byte-identical (`git diff --stat src/data/tiger.generated.ts` shows nothing) — shape emission must not perturb the location data.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/data/shapes-dataset.test.ts`
Expected: PASS (the geoid-coverage test passes vacuously for curated rows — they get geoids in Task 3; tiger rows all resolve).
Then: `npm test -- --run` — full suite green.

- [ ] **Step 6: Commit**

```powershell
git add scripts/build-locations.mjs public/shapes-pr.json src/data/shapes-dataset.test.ts
git commit -m @'
Emit simplified TIGER polygon shapes to public/shapes-pr.json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Add geoids to curated locations

**Files:**
- Modify: `src/data/curated.ts` (all 78 municipio rows + 10 barrio rows)
- Create then delete: `scripts/tmp-add-geoids.mjs` (one-off)

**Interfaces:**
- Consumes: `GameLocation.geoid?: string` (already in `src/data/types.ts`).
- Produces: every curated municipio row carries its county geoid (`'72' + COUNTYFP`); 10 curated barrios carry Census unit geoids. The 6 remaining curated barrios (Isla Verde, Hato Rey, La Perla, Levittown, Piñones, Guavate) intentionally get **no** geoid — no clean Census unit exists (verified against COUSUB/PLACE/SUBBARRIO name search) — and keep point behavior.

- [ ] **Step 1: Write the one-off injection script**

Create `scripts/tmp-add-geoids.mjs`:

```js
// One-off: inject geoid fields into src/data/curated.ts. Delete after running.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'src', 'data', 'curated.ts');

// Inverse of the build script's MUNICIPIOS map: name -> county GEOID.
const MUNICIPIO_GEOID = {
  Adjuntas: '72001', Aguada: '72003', Aguadilla: '72005', 'Aguas Buenas': '72007',
  Aibonito: '72009', 'Añasco': '72011', Arecibo: '72013', Arroyo: '72015',
  Barceloneta: '72017', Barranquitas: '72019', 'Bayamón': '72021', 'Cabo Rojo': '72023',
  Caguas: '72025', Camuy: '72027', 'Canóvanas': '72029', Carolina: '72031',
  'Cataño': '72033', Cayey: '72035', Ceiba: '72037', Ciales: '72039',
  Cidra: '72041', Coamo: '72043', 'Comerío': '72045', Corozal: '72047',
  Culebra: '72049', Dorado: '72051', Fajardo: '72053', Florida: '72054',
  'Guánica': '72055', Guayama: '72057', Guayanilla: '72059', Guaynabo: '72061',
  Gurabo: '72063', Hatillo: '72065', Hormigueros: '72067', Humacao: '72069',
  Isabela: '72071', Jayuya: '72073', 'Juana Díaz': '72075', Juncos: '72077',
  Lajas: '72079', Lares: '72081', 'Las Marías': '72083', 'Las Piedras': '72085',
  'Loíza': '72087', Luquillo: '72089', 'Manatí': '72091', Maricao: '72093',
  Maunabo: '72095', 'Mayagüez': '72097', Moca: '72099', Morovis: '72101',
  Naguabo: '72103', Naranjito: '72105', Orocovis: '72107', Patillas: '72109',
  'Peñuelas': '72111', Ponce: '72113', Quebradillas: '72115', 'Rincón': '72117',
  'Río Grande': '72119', 'Sabana Grande': '72121', Salinas: '72123', 'San Germán': '72125',
  'San Juan': '72127', 'San Lorenzo': '72129', 'San Sebastián': '72131', 'Santa Isabel': '72133',
  'Toa Alta': '72135', 'Toa Baja': '72137', 'Trujillo Alto': '72139', Utuado: '72141',
  'Vega Alta': '72143', 'Vega Baja': '72145', Vieques: '72147', Villalba: '72149',
  Yabucoa: '72151', Yauco: '72153',
};

// Curated barrios with a real Census unit, verified against TIGER 2022 name search.
// (Isla Verde, Hato Rey, La Perla, Levittown, Piñones, Guavate have none — left alone.)
const BARRIO_GEOID = {
  'Viejo San Juan': '7212776812', //   San Juan Antiguo barrio (COUSUB)
  Santurce: '7212779693', //           Santurce barrio (COUSUB)
  'Río Piedras': '721276472971576', // Río Piedras Antiguo subbarrio
  Condado: '721277969319927', //       Condado subbarrio
  Miramar: '721277969353638', //       Miramar subbarrio
  'Ocean Park': '721277969356950', //  Ocean Park subbarrio
  'Puerta de Tierra': '721277681265249', // Puerta de Tierra subbarrio
  'Barrio Obrero': '721277969356907', //    Obrero subbarrio
  'Boquerón': '7202308012', //         Boquerón barrio, Cabo Rojo (COUSUB)
  'Playa de Ponce': '7211362751', //   Playa barrio, Ponce (COUSUB)
};

let src = readFileSync(PATH, 'utf8');
let touched = 0;

src = src.replace(
  /(\{ id: \d+, name: '((?:[^'\\]|\\.)*)',[^}]*source: '(?:geonames|curated)', )(lat:)/g,
  (full, head, rawName, latToken) => {
    const name = rawName.replace(/\\'/g, "'");
    const geoid = head.includes("category: 'municipio'")
      ? MUNICIPIO_GEOID[name]
      : BARRIO_GEOID[name];
    if (!geoid) return full;
    touched++;
    return `${head}geoid: '${geoid}', ${latToken}`;
  },
);

writeFileSync(PATH, src, 'utf8');
console.log(`injected geoid into ${touched} rows (expected 88: 78 municipios + 10 barrios)`);
```

- [ ] **Step 2: Run it, verify the count, delete it**

Run: `node scripts/tmp-add-geoids.mjs`
Expected: `injected geoid into 88 rows`. If the count differs, `git checkout -- src/data/curated.ts` and diagnose before retrying.
Spot-check: `Select-String -Path src/data/curated.ts -Pattern "geoid" | Measure-Object` → Count 88, and the San Juan municipio line contains `geoid: '72127'`.
Then delete: `Remove-Item scripts/tmp-add-geoids.mjs`.

- [ ] **Step 3: Tighten the dataset test**

The coverage test from Task 2 now exercises curated geoids too. Add one more test to `src/data/shapes-dataset.test.ts` inside the existing `describe`:

```ts
  it('gives every curated municipio a county shape', () => {
    const shapes = loadShapes();
    const missing = LOCATIONS.filter(
      (l) => l.category === 'municipio' && (!l.geoid || !shapes[l.geoid]),
    ).map((l) => l.name);
    expect(missing).toEqual([]);
  });
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run`
Expected: all green — every curated geoid resolves against shapes-pr.json (subbarrios and counties were emitted in Task 2). A failure here means a geoid typo: check the failing name against the tables above.

- [ ] **Step 5: Commit**

```powershell
git add src/data/curated.ts src/data/shapes-dataset.test.ts
git commit -m @'
Map curated locations to Census shape geoids

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Shape loader — `src/lib/shapes.ts`

**Files:**
- Create: `src/lib/shapes.ts`
- Test: `src/lib/shapes.test.ts` (create)

**Interfaces:**
- Consumes: `MultiPolygon` type from `./scoring`.
- Produces (App and MapView rely on these):
  - `startShapeLoad(url?: string): Promise<void>` — idempotent; never rejects
  - `getShape(geoid: string | undefined): MultiPolygon | undefined`
  - `resetShapesForTest(): void`

- [ ] **Step 1: Write the failing test**

Create `src/lib/shapes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/shapes.test.ts`
Expected: FAIL — cannot resolve `./shapes`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/shapes.ts`:

```ts
import type { MultiPolygon } from './scoring';

/**
 * Boundary shapes, keyed by Census GEOID, generated by scripts/build-locations.mjs.
 * Loaded once in the background; every consumer goes through getShape() so a
 * future backend can replace this static file without touching callers.
 */
let shapes: Record<string, MultiPolygon> | null = null;
let loadPromise: Promise<void> | null = null;

/** Kick off (or join) the one background load. Never rejects. */
export function startShapeLoad(url = '/shapes-pr.json'): Promise<void> {
  loadPromise ??= fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      shapes = (await response.json()) as Record<string, MultiPolygon>;
    })
    .catch((error: unknown) => {
      // Not fatal: reveals fall back to pin-only, scoring to point distance.
      console.warn('Shape data unavailable — playing without boundaries.', error);
    });
  return loadPromise;
}

/** Shape for a geoid, or undefined if unknown / not yet loaded / load failed. */
export function getShape(geoid: string | undefined): MultiPolygon | undefined {
  if (!geoid || !shapes) return undefined;
  return shapes[geoid];
}

export function resetShapesForTest(): void {
  shapes = null;
  loadPromise = null;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/shapes.test.ts`
Expected: PASS. Then `npm test -- --run` — green.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/shapes.ts src/lib/shapes.test.ts
git commit -m @'
Add background shape loader with pin-only fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Wire shape scoring into the game

**Files:**
- Modify: `src/lib/game.ts` (RoundOutcome + buildShareText)
- Modify: `src/App.tsx` (shape load kickoff + handleGuess)
- Test: `src/lib/game.test.ts` (add share-text cases)

**Interfaces:**
- Consumes: `getShape`, `startShapeLoad` from `./lib/shapes`; `pointInMultiPolygon`, `distanceToShapeKm` from `./lib/scoring`.
- Produces: `RoundOutcome` gains `inside: boolean` — **every** construction site and test fixture must now provide it. Share text renders `¡Adentro!` for inside rounds.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/game.test.ts` (new `describe` at the end; extend the existing imports with `buildShareText`):

```ts
describe('buildShareText', () => {
  const base = {
    location: LOCATIONS[0],
    guess: { lat: 18.2, lng: -66.7 },
  };

  it('shows the distance for outside guesses', () => {
    const text = buildShareText(
      [{ ...base, distanceKm: 12.3, points: 1450, inside: false }],
      1450,
    );
    expect(text).toContain('12.3 km');
    expect(text).not.toContain('¡Adentro!');
  });

  it('shows ¡Adentro! instead of a distance for inside guesses', () => {
    const text = buildShareText(
      [{ ...base, distanceKm: 0, points: 5000, inside: true }],
      5000,
    );
    expect(text).toContain('¡Adentro!');
    expect(text).not.toContain('0 m');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/game.test.ts`
Expected: FAIL — TypeScript: `inside` is not a property of `RoundOutcome` (and share text lacks `¡Adentro!`).

- [ ] **Step 3: Implement**

In `src/lib/game.ts`:

1. Extend the interface:

```ts
export interface RoundOutcome {
  location: GameLocation;
  guess: LatLng;
  distanceKm: number;
  points: number;
  /** True when the guess landed inside the target's boundary shape. */
  inside: boolean;
}
```

2. In `buildShareText`, replace the line that renders each round:

```ts
    const distanceLabel = outcome.inside ? '¡Adentro!' : formatDistance(outcome.distanceKm);
    return `${badge} ${medalFor(outcome.points)} ${displayName(outcome.location)} — ${distanceLabel} — ${outcome.points.toLocaleString('en-US')}`;
```

In `src/App.tsx`:

1. Update imports:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { distanceToShapeKm, haversineKm, pointInMultiPolygon, scoreForDistance, type LatLng } from './lib/scoring';
import { getShape, startShapeLoad } from './lib/shapes';
```

2. Kick off the background load — first line inside the `App` component body:

```ts
  useEffect(() => {
    void startShapeLoad();
  }, []);
```

3. Replace the body of `handleGuess`:

```ts
    (guess: LatLng) => {
      if (phase !== 'playing' || !currentLocation) return;
      const shape = getShape(currentLocation.geoid);
      const inside = shape ? pointInMultiPolygon(guess, shape) : false;
      const distanceKm = shape
        ? distanceToShapeKm(guess, shape)
        : haversineKm(guess, currentLocation);
      const points = scoreForDistance(distanceKm);
      setOutcomes((previous) => [
        ...previous,
        { location: currentLocation, guess, distanceKm, points, inside },
      ]);
      setPhase('revealed');
    },
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- --run` — green (no other file constructs a `RoundOutcome`).
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/game.ts src/lib/game.test.ts src/App.tsx
git commit -m @'
Score against boundary shapes; inside guesses are perfect

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Render the shape on reveal + result surfaces

**Files:**
- Modify: `src/components/MapView.tsx`
- Modify: `src/App.tsx` (pass the two new props)
- Modify: `src/components/RoundResult.tsx`
- Modify: `src/components/Results.tsx`

**Interfaces:**
- Consumes: `MultiPolygon`, `nearestPointOnShape` from `../lib/scoring`; `getShape` from `../lib/shapes`; `RoundOutcome.inside` from Task 5.
- Produces: `MapViewProps` gains `targetShape: MultiPolygon | null` and `inside: boolean`.

- [ ] **Step 1: MapView — polygon, smarter line, tooltip, bounds**

In `src/components/MapView.tsx`:

1. Imports — add `Polygon` to the react-leaflet import list, and:

```ts
import { nearestPointOnShape, type MultiPolygon, type LatLng } from '../lib/scoring';
```

(replace the existing `import type { LatLng } from '../lib/scoring';` line).

2. Extend both prop interfaces and thread the values through:

```ts
interface ViewControllerProps {
  roundIndex: number;
  revealed: boolean;
  guess: LatLng | null;
  target: GameLocation | null;
  targetShape: MultiPolygon | null;
}
```

```ts
interface MapViewProps {
  roundIndex: number;
  interactive: boolean;
  revealed: boolean;
  guess: LatLng | null;
  target: GameLocation | null;
  targetShape: MultiPolygon | null;
  inside: boolean;
  onGuess: (guess: LatLng) => void;
}
```

3. In `ViewController`, replace the reveal-zoom effect so the camera covers the whole shape:

```ts
  useEffect(() => {
    if (revealed && guess && target) {
      const bounds = L.latLngBounds([guess.lat, guess.lng], [target.lat, target.lng]);
      if (targetShape) {
        for (const part of targetShape) {
          for (const point of part[0]) bounds.extend(point as L.LatLngTuple); // outer ring only
        }
      }
      map.flyToBounds(bounds.pad(targetShape ? 0.15 : 0.4), { duration: 0.8, maxZoom: 13 });
    }
  }, [revealed, guess, target, targetShape, map]);
```

4. In the `MapView` component, accept the new props (`targetShape`, `inside`) and compute the line endpoint just above `return`:

```ts
  // Outside guesses point at the nearest boundary, not the internal point.
  const lineEnd: LatLng | null =
    revealed && guess && target
      ? targetShape
        ? inside
          ? null // inside: no line at all
          : nearestPointOnShape(guess, targetShape).point
        : { lat: target.lat, lng: target.lng }
      : null;
```

5. Update the JSX inside the reveal fragment — pass `targetShape={targetShape}` to `ViewController`, draw the shape **before** the markers so pins stay on top, gate the `Polyline` on `lineEnd`, and localize the guess tooltip:

```tsx
        <ViewController
          roundIndex={roundIndex}
          revealed={revealed}
          guess={guess}
          target={target}
          targetShape={targetShape}
        />

        {revealed && targetShape &&
          targetShape.map((part, index) => (
            <Polygon
              key={index}
              positions={part}
              pathOptions={{ color: '#2dd4a7', weight: 2, fillColor: '#2dd4a7', fillOpacity: 0.15 }}
            />
          ))}

        {revealed && guess && target && (
          <>
            {lineEnd && (
              <Polyline
                positions={[
                  [guess.lat, guess.lng],
                  [lineEnd.lat, lineEnd.lng],
                ]}
                pathOptions={{
                  color: '#ffffff',
                  weight: 2.5,
                  opacity: 0.9,
                  dashArray: '6 8',
                  className: 'guess-line',
                }}
              />
            )}
            <Marker position={[guess.lat, guess.lng]} icon={GUESS_ICON}>
              <Tooltip direction="top" permanent className="map-tag map-tag--guess">
                {inside ? '¡Adentro!' : 'Tu toque'}
              </Tooltip>
            </Marker>
            <Marker position={[target.lat, target.lng]} icon={TARGET_ICON}>
              <Tooltip direction="top" permanent className="map-tag map-tag--target">
                {target.name}
              </Tooltip>
            </Marker>
          </>
        )}
```

- [ ] **Step 2: App — pass the new props**

In `src/App.tsx`, update the `<MapView …>` call:

```tsx
      <MapView
        roundIndex={roundIndex}
        interactive={phase === 'playing'}
        revealed={revealed}
        guess={revealed && lastOutcome ? lastOutcome.guess : null}
        target={revealed && currentLocation ? currentLocation : null}
        targetShape={
          revealed && currentLocation ? (getShape(currentLocation.geoid) ?? null) : null
        }
        inside={revealed && lastOutcome ? lastOutcome.inside : false}
        onGuess={handleGuess}
      />
```

- [ ] **Step 3: Result surfaces**

`src/components/RoundResult.tsx` — replace the Distance stat value:

```tsx
          <strong className="stat__value">
            {outcome.inside ? '¡Adentro!' : formatDistance(outcome.distanceKm)}
          </strong>
```

`src/components/Results.tsx` — replace the distance cell:

```tsx
                  <td>{outcome.inside ? '¡Adentro!' : formatDistance(outcome.distanceKm)}</td>
```

- [ ] **Step 4: Typecheck, test, build**

Run: `npx tsc --noEmit` — clean.
Run: `npm test -- --run` — green.
Run: `npm run build` — succeeds; the JS bundle must stay ~546 KB (shapes are fetched, never imported — a jump here means someone imported the JSON).

- [ ] **Step 5: Manual verification (dev server)**

Run: `npm run dev`, open http://localhost:5173/ and play rounds until you've seen each case:

1. **Barrio/comunidad round, tap inside** → green boundary drawn, no dashed line, guess pin says "¡Adentro!", +5,000, result panel says ¡Adentro!.
2. **Same, tap outside** → dashed line ends at the boundary edge (not the pin), distance = gap to the edge.
3. **Municipio round** → full municipal boundary appears; anywhere inside = 5,000.
4. **Landmark round** → exactly the old behavior (pins + line to point, no polygon).
5. **Results screen + Copy result** → ¡Adentro! rows render in table and clipboard text.
6. Network tab: `shapes-pr.json` fetched once, in the background, at app load.
7. DevTools → throttle to Offline before first load: game still playable, reveals are pin-only, one console warning.

- [ ] **Step 6: Commit**

```powershell
git add src/components/MapView.tsx src/components/RoundResult.tsx src/components/Results.tsx src/App.tsx
git commit -m @'
Draw target boundary on reveal with ¡Adentro! treatment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

## Self-review notes

- **Spec coverage:** pipeline §1 → Task 2; curated geoids §1 → Task 3; loader §2 → Task 4; scoring §3 → Tasks 1+5; rendering §4 → Task 6; result surfaces §5 → Tasks 5+6; error handling §6 → Task 4 tests + Task 6 step 5.7; testing §7 → each task's tests.
- **Type consistency:** `MultiPolygon = Ring[][]` (`[lat,lng]`) is defined once in `scoring.ts` (Task 1) and consumed by Tasks 2 (emitted JSON matches shape), 4, 5, 6. `RoundOutcome.inside` introduced in Task 5, consumed in Task 6.
- **Fallback invariant:** every consumer treats `getShape(...) === undefined` as "behave exactly like before this feature" — verified by the untouched landmark path in Task 6 step 5.4.
