# IslaTap — Design Spec

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation via one-shot agent (Fable)

**Naming note (2026-07-05):** originally designed under the working name
"MapTap PR" (as an homage to [maptap.gg](https://maptap.gg/), the game that
inspired this project). Renamed to **IslaTap** to avoid trademark confusion
with MapTap Inc.'s product — the mechanics/scoring/data below are unchanged,
only the brand name is. References to "maptap.gg" and "maptap's core loop"
below describe the inspiration, not our own branding.

## Summary

A frontend-only geography guessing game for Puerto Rico, modeled on
[maptap.gg](https://maptap.gg/). The player is shown a satellite map of the
Puerto Rico archipelago and prompted to "Tap as close as you can to **X**",
where X is a municipio, landmark, or barrio. Scoring is distance-based over 5
rounds. No backend in v1; the architecture leaves room to add one later.

## Goals

- Faithful recreation of maptap's core loop, scoped to Puerto Rico.
- Frontend-only, deployable as a static site.
- Data-driven so content (locations) can be corrected/expanded without code
  changes.
- Clean enough to grow a backend onto later (accounts, leaderboards, daily
  puzzle).

## Non-Goals (v1)

- User accounts / authentication.
- Server-side leaderboards or persistence (localStorage best-score only).
- Daily-puzzle server / shared seed.
- MapLibre GL / vector tiles (Leaflet + raster satellite is the chosen path).

## Gameplay

- **Session:** 5 rounds, cumulative score. Max 25,000 (5,000/round).
- **Round:** show prompt "Tap as close as you can to **{name}**" (with a
  category + difficulty tag). Player pans/zooms the satellite map and taps
  once. On tap:
  - Drop the player's pin.
  - Reveal the true location marker.
  - Draw a line between guess and truth.
  - Show distance (m under 1 km, else km to 1 decimal) and round points.
  - "Next" advances; after round 5, show results.
- **Results screen:** total score, per-round breakdown (name, distance,
  points), and a shareable text summary. Persist best score in localStorage.
- **Round draw:** 5 distinct locations selected at random from the pool with
  category variety (avoid all-same-category games). No repeats within a game.

## Scoring

- Haversine great-circle distance `d` (km) between guess and target.
- `points = round(5000 * Math.exp(-d / 10))`, clamped to `[0, 5000]`.
  - 0 km → 5000, 1 km → ~4520, 5 km → ~3030, 10 km → ~1840, 20 km → ~680.
- Scale factor `10` is tuned to PR's size (~180 km E–W); kept as a named
  constant for easy tuning.

## Map

- **Engine:** `react-leaflet` (Leaflet). Chosen for one-shot reliability:
  bulletproof click handling, markers, and polyline distance line with raster
  tiles.
- **Base layer:** Esri World Imagery —
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
  attribution "Tiles © Esri". No API key required. (Licensing note below.)
- **View lock:** `maxBounds` to the PR archipelago (SW `[17.8, -68.0]`, NE
  `[18.6, -65.1]`) so the player can't pan off into blank ocean/world.
  `minZoom ≈ 9`, `maxZoom ≈ 16`, initial view fit to the main island.
- The true-location marker and the line are hidden until the player taps.

## Data

Single data-driven module `src/data/locations.ts` (already built & vetted,
committed in this repo). Shape:

```ts
export interface GameLocation {
  id: number;
  name: string;
  category: 'municipio' | 'landmark' | 'barrio';
  difficulty: 'easy' | 'medium' | 'hard';
  lat: number;
  lng: number;
}
export const LOCATIONS: GameLocation[];
```

**Contents (120 locations):**

- **78 municipios** — GeoNames `PPLA` town-seat coordinates (authoritative).
  Difficulty auto-tiered by municipio population (easy ≥60k, medium ≥20k,
  hard <20k).
- **26 landmarks** — hand-verified coordinates (El Morro, Castillo San
  Cristóbal, La Fortaleza, Observatorio de Arecibo, El Yunque, Cerro de Punta,
  the offshore islands Mona/Culebra/Vieques/Desecheo/Caja de Muertos, Playa
  Flamenco, Bahía Mosquito, Camuy caves, Bacardí, etc.).
- **16 barrios** — curated neighborhood centroids (Viejo San Juan, Santurce,
  Río Piedras, Condado, Isla Verde, Hato Rey, Piñones, Guavate, La Perla,
  Boquerón, …). Six (Río Piedras, Condado, Miramar, Ocean Park, Puerta de
  Tierra, Barrio Obrero) use authoritative 2025 Census subbarrio internal
  points (`tl_2025_72_subbarrio`); the remainder are approximate and flagged in
  the data comments.

**Sources:** GeoNames PR export (`download.geonames.org/export/dump/PR.zip`)
for municipio seats and geographic features; hand-curation for landmarks and
barrios (6 later hardened from the 2025 Census `subbarrio` layer). The
remaining approximate barrios are the weakest link and the first thing to harden
in a later pass. The authoritative upgrade path is the TIGER/Line
**county-subdivision (`cousub`)** layer — all ~900 barrios island-wide with
Census centroids — plus the **Place** layer for CDPs (Isla Verde, Levittown).
The `subbarrio` layer only covers 23 municipios' urban cores (mostly generic
"Pueblo Norte/Sur" names), so it hardened only the 6 San Juan barrios that
matched by name.

## Architecture / Components

- `App` — top-level state machine: `idle → playing(round n) → revealed → …
  → results`.
- `MapView` — Leaflet map, satellite layer, bounds lock, tap handler, and
  guess/truth markers + line for the revealed state.
- `RoundPrompt` — shows the target name, category/difficulty tag, round
  counter, running score.
- `RoundResult` — distance + points panel, "Next" button.
- `Results` — final score, per-round table, share summary, "Play again".
- `lib/scoring.ts` — `haversineKm(a, b)` and `scoreForDistance(km)`.
- `lib/game.ts` — round selection (random, distinct, category-varied).
- `data/locations.ts` — the vetted dataset (this repo).

State is local React state; no global store needed at this size. The
`data/locations.ts` interface and the `lib/*` pure functions are the seams a
future backend plugs into (fetch locations remotely, post scores, fetch daily
seed).

## Error / Edge Handling

- Tap outside `maxBounds` is clamped by Leaflet (bounds lock), so guesses are
  always on-map.
- Tile load failure: Leaflet shows blank tiles; acceptable for v1 (no offline
  fallback). Attribution always rendered.
- No network for data — dataset is bundled, so the game works offline after
  first tile cache.

## Testing

- Unit-test `lib/scoring.ts` (`haversineKm` against known distances;
  `scoreForDistance` monotonic + endpoints).
- Unit-test `lib/game.ts` round selection (5 distinct, in-pool, variety).
- Manual/visual QA of the map interaction (tap → reveal → score).

## Licensing Note

Esri World Imagery is used key-free with attribution for this prototype. Its
ToS restricts commercial use; when the project goes public or adds a backend,
switch the base layer to **MapTiler Satellite** (free tier, API key) or **EOX
Sentinel-2 Cloudless** (no key, CC-BY, lower max resolution). The base-layer
URL is isolated to one place in `MapView` to make this a one-line swap.

## Deliverable

The implementation is produced by a separate one-shot agent (Fable) from a
prompt that embeds the full vetted `locations.ts` inline (so the agent invents
no coordinates). See `FABLE_PROMPT.md` in the repo root.
