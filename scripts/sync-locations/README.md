# sync-locations

Syncs a deployed database to the location data in this checkout, showing
exactly what will change before it changes it.

```bash
npm run db:sync -- --dry-run                 # uses .env, writes nothing
npm run db:sync -- --env=.env.production     # diff, confirm, then write
```

Or directly:

```bash
node scripts/sync-locations/sync-locations.mjs --database-url='postgresql://...' --yes
node --env-file=.env scripts/sync-locations/sync-locations.mjs
```

## Why this exists at all

Everything in `src/data/` is the source of truth; the database is a projection
of it. **A deploy does not touch Postgres.** Vercel ships the client bundle,
which fixes practice mode — it imports `src/data/curated.ts` directly — while
daily mode keeps reading coordinates from the database. Until someone runs this
script, the two modes disagree about where places are.

Nothing in the repo said so, and nothing automated the second half. That is the
gap this fills.

## Why not just `npm run db:seed`

`db:seed` is the right tool for standing a **new** database up. It upserts 1088
locations and 1422 shapes and tells you nothing about what moved, which is fine
when the answer is "everything, it was empty".

It is the wrong tool for a database with players on it. An upsert leaves no
trace of the old value and `location` has no `updated_at`, so a location edit
is unreviewable after the fact. Six coordinates in this repo were wrong for
months precisely because nothing ever compared them to anything.

So this script reads the current rows **first**, diffs them against the files,
and makes you look at the list before it writes:

```
Coordinate changes (6):
    96  Parque de las Cavernas del Río Camuy  18.3856,-66.8236  ->  18.34399,-66.82619  (4.635 km)
    97  Cueva Ventana                         18.3492,-66.7176  ->  18.37122,-66.69156  (3.681 km)
```

The write itself is `scripts/seed.mjs`'s, imported rather than reimplemented,
so there is one upsert statement in this repo instead of two that can drift
apart.

## Options

| Flag | Meaning |
|---|---|
| `--database-url=<url>` | Neon connection string. Highest precedence. |
| `--env=<path>` | Read `DATABASE_URL` from this file. Defaults to `.env`. |
| `--dry-run` | Print the diff and exit without writing. |
| `--yes`, `-y` | Skip the confirmation prompt. |
| `--help`, `-h` | Usage. |

`DATABASE_URL` resolves in this order:

```
--database-url  >  --env  >  process.env  >  ./.env
```

### The flag is `--env`, not `--env-file`

Deliberately. Node itself claims `--env-file` **anywhere** in `argv`, script
arguments included. It loads the file into `process.env` and, when the path
does not exist, exits with its own `node: nope.env: not found` before this
script ever runs — so a friendlier message here would be unreachable.

Node's flag still works and is handled by the `process.env` branch:

```bash
node --env-file=.env.production scripts/sync-locations/sync-locations.mjs
```

`--env-file=` is also accepted as a synonym for `--env=`, for whoever types it
out of habit.

## Safety behaviour

- Validates the source files **before** opening a connection, so a malformed
  edit fails in under a second and never leaves a half-applied batch.
- Warns when the host does not look like a pooled Neon endpoint (no `-pooler`).
  See README section 1 — the unpooled endpoint exhausts its connection limit
  under real traffic.
- Prints the host, never the password.
- Refuses to write when stdin is not a TTY, so CI must pass `--yes` explicitly.
- Reads the rows back after writing rather than trusting the write. An upsert
  that silently matched nothing looks exactly like one that worked.
- `SYNC_DEBUG=1` prints the stack when a failure is a bug in here rather than a
  bad connection string.

## What it deliberately does not do

- **No puzzle regeneration.** `api/guess.ts` resolves coordinates at request
  time, so the 30-day buffer of `puzzle_round` rows picks up corrected values
  on its own. Do not delete `daily_puzzle` rows.
- **No deletes.** `puzzle_round.location_id` references `location`, so removing
  a row is a deliberate manual operation, never a side effect of a sync. Rows
  in the database but absent from the files are listed and left alone.
- **No shape diffing.** Shapes are upserted but not compared; run
  `npm run db:seed` if a regen changed `public/shapes-pr.json`.

## Operational notes

Run it from a checkout that contains the change — the script projects the local
working tree, not whatever is deployed.

Time it for low traffic. A player mid-round on a location whose coordinate
moves will see the answer shift under them.

Regenerating TIGER data is a different and more dangerous operation.
`scripts/build-locations.mjs` renumbers ids from 1000 after sorting by
`(municipio, name, geoid)`, so adding one barrio shifts every id after it and
retroactively repoints `puzzle_round.location_id`. Freeze the ids or migrate
`puzzle_round` explicitly before ever doing that.

## Implementation note

Coordinates are compared as numbers with a `1e-9` epsilon, never as strings.
The columns are `double precision` and the driver may hand back either
representation, so `18.4692 !== '18.4692'` would report all 1088 rows as
changed and make the diff useless.
