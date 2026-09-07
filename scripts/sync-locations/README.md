# sync-locations

Syncs a deployed database to the location data in this checkout.

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
of it. Coordinates might change as the result of incorrectness, removal of certain landmarks, etc. This script cross-checks against a given postgres DB and syncs locations to match what we have in `src/data` on the local branch.

```
Coordinate changes (6):
    96  Parque de las Cavernas del Río Camuy  18.3856,-66.8236  ->  18.34399,-66.82619  (4.635 km)
    97  Cueva Ventana                         18.3492,-66.7176  ->  18.37122,-66.69156  (3.681 km)
```

## Options

| Flag                   | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `--database-url=<url>` | Neon connection string. Highest precedence.             |
| `--env=<path>`         | Read `DATABASE_URL` from this file. Defaults to `.env`. |
| `--dry-run`            | Print the diff and exit without writing.                |
| `--yes`, `-y`          | Skip the confirmation prompt.                           |
| `--help`, `-h`         | Usage.                                                  |

`DATABASE_URL` resolves in this order:

```
--database-url  >  --env  >  process.env  >  ./.env
```

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

## Don't use this script for the following

- **puzzle regeneration.** `api/guess.ts` resolves coordinates at request
  time, so the 30-day buffer of `puzzle_round` rows picks up corrected values
  on its own. Do not delete `daily_puzzle` rows. This gets handled by CRON.
- **No deletes.** `puzzle_round.location_id` references `location`, so removing
  a row is a deliberate manual operation, never a side effect of a sync. Rows
  in the database but absent from the files are listed and left alone.
- **No shape diffing.** Shapes are upserted but not compared; run
  `npm run db:seed` if a regen changed `public/shapes-pr.json`.

## Operational notes

Time it for low traffic. A player mid-round on a location whose coordinate
moves will see the answer shift under them.

Regenerating TIGER data is a different and more dangerous operation.
`scripts/build-locations.mjs` renumbers ids from 1000 after sorting by
`(municipio, name, geoid)`, so adding one barrio shifts every id after it and
retroactively repoints `puzzle_round.location_id`. Freeze the ids or migrate
`puzzle_round` explicitly before ever doing that.
