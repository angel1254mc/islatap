# IslaTap 🇵🇷

A Puerto Rico geography guessing game, tap-the-map style. Tap a satellite map as close as you can to the prompted place - 5 rounds, distance-based scoring, 25,000 points max.

**Play now: https://islatap.angel1254.com**

## Stack

React + Vite + TypeScript, react-leaflet with Esri World Imagery satellite tiles.

## Dev

```bash
npm install
npm run dev
```

## Test / build

```bash
npm test
npm run build
```

## Server setup

The daily puzzle is served by Vercel serverless functions backed by a Neon
Postgres database. The database is a *projection* of files already in this
repo (`src/data/curated.ts`, `src/data/tiger.generated.ts`,
`public/shapes-pr.json`), so standing one up is three commands.

### 1. Local environment

```bash
cp .env.example .env
```

Then edit `.env` and set `DATABASE_URL` to your Neon connection string. Use the
**pooled** endpoint — its hostname contains `-pooler`. The HTTP driver opens a
fresh connection per request, so the unpooled endpoint runs out of connections
under any real traffic. `.env` is gitignored and must stay that way.

### 2. Create the schema, then load the data

```bash
npm run db:migrate
npm run db:seed
```

**Order matters: `db:migrate` must run before `db:seed`.** The seed inserts
into tables the migration creates, and `location.geoid` is a foreign key to
`shape.geoid`, so there is nothing to insert into until the migration has run.

Both commands are idempotent. `db:migrate` records applied files in a
`schema_migration` table and skips them on a re-run; `db:seed` upserts, so
re-running it after a `node scripts/build-locations.mjs` regen is the only
follow-up step that regen needs.

### 2b. Updating location data on a database that already exists

Everything in `src/data/` is the source of truth; the database is a projection
of it. So editing a coordinate is only half the job — **a deploy does not touch
Postgres.** Vercel ships the client bundle, which fixes practice mode (it
imports `src/data/curated.ts` directly), while daily mode keeps reading
coordinates from the database. Until someone runs the sync, the two disagree.

```bash
npm run db:sync -- --dry-run                 # uses .env, writes nothing
npm run db:sync -- --env=.env.production     # diff, confirm, then write
```

`sync-locations.mjs` reads the current rows first and prints exactly what will
change before changing it:

```
Coordinate changes (6):
    96  Parque de las Cavernas del Río Camuy   18.3856,-66.8236  ->  18.34399,-66.82619  (4.635 km)
    97  Cueva Ventana                          18.3492,-66.7176  ->  18.37122,-66.69156  (3.681 km)
```

It resolves `DATABASE_URL` from `--database-url`, then `--env=<path>`, then the
environment (which is where `node --env-file=...` lands), then `./.env`. It
asks for confirmation unless given `--yes`, refuses to write with no TTY to
confirm on, and reads the rows back afterwards rather than trusting the write.

`npm run db:seed` still works and is what you want for a *new* database. Prefer
`db:sync` against anything with players on it: an upsert leaves no trace of the
old value and `location` has no `updated_at`, so an unreviewed location edit is
not recoverable after the fact.

Two things this deliberately does not do:

- **No puzzle regeneration.** `api/guess.ts` resolves coordinates at request
  time, so the 30-day buffer of `puzzle_round` rows picks up corrected values
  on its own. Do not delete `daily_puzzle` rows.
- **No deletes.** `puzzle_round.location_id` references `location`, so removing
  a row is a deliberate manual operation, never a side effect of a sync.

Time it for low traffic: a player mid-round on a location whose coordinate
moves will see the answer shift under them.

Regenerating TIGER data is a different and more dangerous operation —
`scripts/build-locations.mjs` renumbers ids from 1000 after sorting by
`(municipio, name, geoid)`, so adding one barrio shifts every id after it and
retroactively repoints `puzzle_round.location_id`. Freeze the ids or migrate
`puzzle_round` explicitly before ever doing that.

### 3. Vercel project environment variables

Set both in the Vercel dashboard (Project → Settings → Environment Variables),
for every environment you deploy:

- `DATABASE_URL` — the same pooled (`-pooler`) Neon connection string.
- `CRON_SECRET` — generate with `openssl rand -hex 32`. Vercel injects it as
  `Authorization: Bearer $CRON_SECRET` on cron invocations. `/api/cron/top-up`
  stays publicly routable, so this secret is the only thing protecting the
  single write path in production; with it unset the endpoint denies everyone.

### 4. The schedule

`vercel.json` declares one cron: `"0 4 * * *"`. Cron schedules on Vercel are
**always UTC**, and Puerto Rico is AST (UTC−4, no DST), so that is midnight
local. The exact minute is cosmetic on purpose — the job tops up a **30-day
buffer** of future puzzles rather than generating "today", so a missed run (or
a month of missed runs) stays invisible to players until the buffer drains.
