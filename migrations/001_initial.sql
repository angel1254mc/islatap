-- 001_initial.sql -- the whole schema for the server-side daily puzzle.
--
-- Applied by: node --env-file=.env scripts/migrate.mjs
-- Seeded by:  node --env-file=.env scripts/seed.mjs
--
-- Design notes that are not obvious from the DDL:
--   * There is no leaderboard, no accounts, no sessions. Player results live
--     in browser localStorage. The ONLY write path in production is the
--     scheduled top-up job; /api/guess is a pure function with zero writes.
--   * Two of these four tables (daily_puzzle, puzzle_round) exist purely so
--     every player on a given calendar day is asked the same five questions.


-- Boundary geometry, keyed exactly as the `geoid` field in src/data/*.ts.
--
-- IMPORTANT: `geometry` is NOT GeoJSON. It is the Leaflet-ordered MultiPolygon
-- produced by scripts/build-locations.mjs: Ring[][] where every point is
-- [lat, lng], the inverse of GeoJSON's [lng, lat]. src/lib/scoring.ts
-- (pointInMultiPolygon, nearestPointOnShape) indexes ring[i][0] as latitude on
-- BOTH the server and the client, and react-leaflet's <Polygon positions>
-- wants the same order. The value therefore travels seed -> jsonb -> guess
-- response -> map render completely untouched. Converting to GeoJSON would
-- mean rewriting every geometry helper and both renderers for no gain.
--
-- jsonb rather than json: every /api/guess call reads exactly one of these,
-- and jsonb skips the reparse. Array order is preserved by jsonb (only object
-- key order is not, and there are no objects inside these values).
CREATE TABLE shape (
  -- Census GEOID whose LENGTH encodes the layer: 5 county, 7 place, 10 cousub,
  -- 15 subbarrio. Six values are instead synthetic non-numeric keys
  -- ('72127-hato-rey', '72113-isla-caja-de-muertos', ...) for curated umbrella
  -- entries that merge several Census units; build-locations.mjs makes them
  -- deliberately non-numeric so they can never collide with a real GEOID.
  -- text, never bigint: those keys would not survive a numeric column, and
  -- leading zeros in real GEOIDs would not survive either.
  geoid     text  PRIMARY KEY,
  geometry  jsonb NOT NULL
);


CREATE TABLE location (
  -- Seeded verbatim from GameLocation.id, NOT generated. Curated rows own
  -- 1-120 and build-locations.mjs numbers TIGER rows from 1000 (max 1967
  -- today), so the range is sparse on purpose. Preserving the source ids is
  -- what makes re-running scripts/seed.mjs idempotent.
  --
  -- This id is server-only and must stay that way: puzzle_round hands the
  -- browser an opaque per-day uuid instead, so no player can accumulate an
  -- id -> coordinate dictionary across days.
  --
  -- CAVEAT for whoever regenerates TIGER data: build-locations.mjs sorts by
  -- (municipio, name, geoid) before numbering, so adding one barrio in
  -- Adjuntas shifts every id after it. puzzle_round.location_id would then
  -- point at different places retroactively. Freeze these ids, or migrate
  -- puzzle_round explicitly, before ever regenerating.
  id          integer PRIMARY KEY,

  name        text NOT NULL,

  -- NULL for all 78 municipios and all 26 landmarks (104 rows); present on
  -- every one of the 984 barrios. Load-bearing, not a data gap: barrio names
  -- collide heavily across municipios (Quebrada Arenas exists six times), so
  -- displayName() renders "name, municipio" whenever this is set.
  municipio   text,

  category    text NOT NULL CHECK (category IN ('municipio', 'landmark', 'barrio')),

  -- 'barrio-pueblo' has zero rows today because build-locations.mjs sets
  -- INCLUDE_BARRIO_PUEBLO = false, but it is a legal Subtype in
  -- src/data/types.ts. Listing it keeps a regen with that flag flipped from
  -- failing the seed on a constraint violation.
  subtype     text NOT NULL CHECK (subtype IN
                ('municipio', 'landmark', 'barrio', 'barrio-pueblo', 'comunidad')),

  difficulty  text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),

  -- Provenance, so a coordinate's authority is always legible from the data.
  source      text NOT NULL CHECK (source IN
                ('geonames', 'curated', 'tiger-cousub', 'tiger-place')),

  -- Exactly one of geoid / radius_km is set on all 1088 rows -- never both,
  -- never neither. This XOR IS the api/guess.ts target discriminant:
  -- geoid -> {type:"SHAPE", geometry}, radius_km -> {type:"CIRCLE", radiusKm}.
  -- 1063 rows carry a geoid; 25 carry a radius (21 landmarks plus Isla Verde,
  -- La Perla, Levittown and Pinones -- colloquial areas with no Census
  -- polygon). Making it a constraint means the discriminant can never be
  -- ambiguous at request time.
  geoid       text REFERENCES shape(geoid),
  radius_km   double precision CHECK (radius_km > 0),

  -- double precision, not numeric. TIGER INTPTLAT/INTPTLON carry 7 decimals
  -- (~1 cm) which double holds exactly, and the Postgres wire protocol returns
  -- numeric as a STRING. A string reaching haversineKm is the precise
  -- NaN-propagation hazard the Zod validation on /api/guess exists to close;
  -- do not reintroduce it at the database layer.
  --
  -- Bounds are the repo's own "greater Puerto Rico" envelope, lifted verbatim
  -- from src/data/shapes-dataset.test.ts: generous enough to include
  -- territorial water in the county polygons plus Mona, Desecheo and the
  -- Culebra cays. Real data occupies 17.89..18.51 / -67.89..-65.24.
  lat         double precision NOT NULL CHECK (lat BETWEEN 17.5 AND 18.8),
  lng         double precision NOT NULL CHECK (lng BETWEEN -68.2 AND -64.9),

  CONSTRAINT location_target_xor
    CHECK ((geoid IS NULL) <> (radius_km IS NULL)),

  -- A shape is a promptable answer, so two locations sharing one would make
  -- the same polygon answerable twice in a single game. Mirrors the assertion
  -- in src/data/shapes-dataset.test.ts. Postgres treats NULLs as distinct by
  -- default, so the 25 radius-only rows do not collide with each other.
  CONSTRAINT location_geoid_unique UNIQUE (geoid)
);


-- The per-category bag randomiser draws "locations in this category with no
-- puzzle_round row at the current cycle", so category is the hot filter on
-- every generation query.
CREATE INDEX location_category_idx ON location (category);


-- One row per calendar day that has been generated. Exists so the top-up job
-- can ask "is this date already claimed?" in one indexed lookup, and so the
-- 30-day buffer has an explicit inventory rather than an inferred one.
--
-- game_date is a DATE, never a timestamp: it is the Puerto Rico calendar day
-- (AST, UTC-4, no DST), resolved by the caller. Storing a timestamp would
-- invite a timezone conversion somewhere and roll the puzzle over at 8pm local.
CREATE TABLE daily_puzzle (
  game_date   date        PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE puzzle_round (
  -- The opaque per-day handle, and the ONLY round identifier the browser ever
  -- receives. /api/daily returns it; /api/guess takes it back and resolves it
  -- to a location server-side. Because it is fresh per (date, slot), it cannot
  -- be accumulated into a lookup table of coordinates the way a stable
  -- location id could. gen_random_uuid() is built into Postgres 13+, so no
  -- extension is required on Neon.
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE so deleting a bad day's daily_puzzle row also returns
  -- its five locations to their bags. cycle_no is derived from these rows
  -- rather than stored in a counter, so deletion is genuinely self-healing.
  game_date    date    NOT NULL REFERENCES daily_puzzle(game_date) ON DELETE CASCADE,

  -- 1-based position within the day. Not bounded above by 5: ROUNDS_PER_GAME
  -- lives in TypeScript and a schema constraint that duplicates it would have
  -- to be migrated in lockstep for no benefit.
  ordinal      smallint NOT NULL CHECK (ordinal >= 1),

  location_id  integer  NOT NULL REFERENCES location(id),

  -- Which pass through this category's bag the draw came from. Derived, never
  -- authoritative: the current cycle is just MAX(cycle_no) over rows of that
  -- category, so there is no counter to initialise, no counter to keep in
  -- sync, and deleting rows walks the cycle backwards automatically.
  --
  -- Rounds of one game may carry two different cycle_no values, by design: a
  -- bag can run dry mid-puzzle (municipio 79 on day 79) and the remainder is
  -- topped up from the next cycle rather than discarded.
  cycle_no     integer  NOT NULL CHECK (cycle_no >= 1),

  -- One location per slot per day. Combined with ON CONFLICT DO NOTHING this
  -- is what makes two overlapping cron invocations safe: the loser's inserts
  -- are dropped instead of doubling the day.
  CONSTRAINT puzzle_round_slot_unique UNIQUE (game_date, ordinal)
);


-- The bag query's inner anti-join: "does this location already have a row at
-- this cycle?" No separate index on game_date is needed -- the
-- puzzle_round_slot_unique constraint already builds one leading with it.
CREATE INDEX puzzle_round_bag_idx ON puzzle_round (location_id, cycle_no);
