# Barrio Shapes on Reveal — Design

**Date:** 2026-07-31
**Status:** Approved

## Goal

After a guess, show the real boundary of the prompted place on the map so players
see how far off they were — and make scoring honor that boundary: a tap inside the
shape is a perfect round.

## Decisions (made with user)

| Decision | Choice |
|---|---|
| Scoring | Inside polygon = 5,000 pts; outside = existing decay curve applied to distance-to-nearest-edge |
| Coverage | Barrios, comunidades, **and municipios** get shapes + new scoring. Landmarks stay point-based |
| Delivery | One simplified static file `public/shapes-pr.json`, background-fetched once at app start |
| Future | Client accesses shapes only via `getShape(geoid)` so a later backend can replace the static file without touching consumers |

## Non-goals

- Landmark shapes (TIGER landmark layers are unusable; landmarks stay curated points).
- Showing shapes before the guess (would trivialize rounds).
- Server component (explicitly deferred by user).
- Topology-preserving simplification (shapes are shown one at a time; shared-border
  gaps between adjacent barrios are invisible in this UI).

## 1. Data pipeline — `scripts/build-locations.mjs`

New TIGER 2022 inputs, cached in `scripts/.tiger-cache/` like existing ones:

| Layer | File | Provides |
|---|---|---|
| COUNTY | `tl_2022_us_county.zip` (~80 MB, one-time) | 78 municipio polygons (STATEFP 72) |
| SUBBARRIO | `tl_2022_72_subbarrio.zip` | Shapes for curated San Juan neighborhoods (Condado, Miramar, …) |

COUSUB and PLACE rings are already parsed today for point-in-polygon.

Per shape:

1. Classify rings by winding order (shapefile spec: CW = outer, CCW = hole) using
   signed area; group each hole under the outer ring that contains it. This keeps
   coastal multipolygon barrios from rendering islets as holes.
2. Simplify each ring with Douglas–Peucker, tolerance ≈ 60 m (in degrees, latitude-
   corrected). Drop rings that collapse below 4 points.
3. Round coordinates to 5 decimals (~1 m).

Output: `public/shapes-pr.json` — `{ [geoid: string]: MultiPolygon }` where
`MultiPolygon = [lat,lng][][][]` (polygons → rings, ring 0 outer, rest holes).
GEOID lengths differ per layer (county 5, place 7, cousub 10, subbarrio 12+) so a
flat map cannot collide. The script logs emitted size; target ≤ 3 MB raw.

`curated.ts` changes:
- All 78 municipios get `geoid: '72xxx'` (county GEOID).
- Curated barrios that correspond to a Census unit get its geoid via a small
  hand-checked table (Viejo San Juan → San Juan Antiguo barrio, Santurce → barrio,
  Condado/Miramar/Ocean Park/Puerta de Tierra/Barrio Obrero/Río Piedras → subbarrios, …).
- Unmatched curated barrios (Guavate, La Perla, Piñones, …) keep no `geoid` and
  therefore today's point behavior.

## 2. Client loading — `src/lib/shapes.ts` (new)

- `startShapeLoad()`: one background `fetch('/shapes-pr.json')`, called from App mount.
- `getShape(geoid: string): MultiPolygon | undefined` — the only consumer-facing API.
- Not yet loaded, or fetch failed → `undefined` → reveal falls back to pin-only
  (today's behavior). No spinner, no error UI, single `console.warn` on failure.
- This module is the seam for the future backend: swap the implementation for a
  per-geoid API call; consumers unchanged.

## 3. Scoring — `src/lib/scoring.ts`

- `distanceToShapeKm(point: LatLng, shape: MultiPolygon): number`
  - Even-odd ray-cast point-in-polygon across all rings → inside → `0`.
  - Outside → min point-to-segment distance over every ring segment, using a local
    equirectangular projection (adequate at PR scale, < 0.1 % error).
- Also exposed: `nearestPointOnShape(point, shape): LatLng` for drawing the line.
- Round flow (App): target has geoid **and** shape available
  → `distanceKm = distanceToShapeKm(guess, shape)`; else `haversineKm(guess, target)`
  exactly as today. `scoreForDistance` and the decay constant are untouched —
  inside yields `exp(0)` = 5,000 naturally.
- `RoundOutcome` gains `inside: boolean`.
- Scoring uses the same simplified geometry that is rendered, so the score always
  matches what the player sees.

## 4. Reveal rendering — `src/components/MapView.tsx`

When revealed and the target has a shape:

- `<Polygon>` per polygon part: color `#2dd4a7`, weight 2, fillOpacity 0.15.
- Target pin remains at the internal point (anchors the name tooltip).
- Outside guess: dashed line guess → `nearestPointOnShape(guess, shape)`.
- Inside guess: no line; guess tooltip reads **"¡Adentro!"** instead of "Tu toque".
- `flyToBounds` covers guess + shape bounds (not just the two pins).

No shape → exactly today's reveal.

## 5. Result surfaces

Wherever a distance is displayed — reveal banner, results table, share text —
`inside` renders `¡Adentro!` in place of the distance. Example share line:
`2️⃣ 🟩 Guilarte, Adjuntas — ¡Adentro! — 5,000`.

## 6. Error handling

| Failure | Behavior |
|---|---|
| shapes-pr.json fetch fails / slow | Pin-only reveals, point scoring; game fully playable |
| geoid present but missing from JSON | Same fallback; dataset test makes this unreachable in practice |
| Degenerate/tiny rings after simplification | Dropped at build time |

## 7. Testing

- **Geometry (vitest):** PIP inside/outside/on-hole/multipolygon; distance-to-edge
  against hand-computed values; `nearestPointOnShape` sanity.
- **Scoring:** inside → 5,000; outside → matches `scoreForDistance(edge distance)`.
- **Dataset (vitest, node fs):** every `geoid` referenced in locations data has an
  entry in `public/shapes-pr.json`; every shape bbox within PR bounds; JSON size
  under budget.
- **Regression:** existing test suite passes untouched — proves the no-shape
  fallback path (landmarks, unmatched curated barrios) still works.
