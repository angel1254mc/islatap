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
