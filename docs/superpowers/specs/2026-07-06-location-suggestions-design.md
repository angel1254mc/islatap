# IslaTap — Location Suggestions Design Spec

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan

## Summary

A location-suggestion feature for IslaTap: players open a picker screen with a
live satellite map of Puerto Rico, search for places Google-Maps-style or tap
the map directly, and submit a location they think should be in the game.
Suggestions are stored in a local SQLite database behind a small Express API
and reviewed by the maintainer via a CLI before being merged (manually) into
the vetted `src/data/locations.ts` dataset.

The server is built now with a clean API/storage boundary so it can be
deployed later (Fly.io/Railway with a volume, or migrated to Turso /
Cloudflare D1 / Postgres) without frontend changes.

## Goals

- Let players propose new locations (name + category + pin) from inside the
  game app.
- Google-Maps-style search: debounced autocomplete scoped to Puerto Rico.
- Persist suggestions in SQLite with a pending/approved/rejected workflow.
- Keep the game dataset hand-vetted: approved suggestions are merged into
  `locations.ts` manually, never auto-served.
- Frontend must be safe to deploy immediately: the suggest screen detects a
  missing API and degrades to an "offline" notice.
- Storage behind an interface so the "real backend later" swap is one file.

## Non-Goals (v1)

- Deploying the API (designed for it, not done in this pass).
- Admin web UI for review (CLI only; the GET/PATCH endpoints make a UI
  purely additive later).
- Auth, accounts, or per-user submission history.
- Rate limiting / abuse protection (irrelevant while local-only; required
  before public deploy — noted in Deployment Path).
- Serving game locations from the API (game keeps its bundled dataset).

## Architecture

Single repo, two processes in dev:

- **Frontend** — existing Vite app; new `suggest` state in the `App` state
  machine renders `SuggestScreen`. All API calls use relative `/api/...`
  URLs.
- **Server** — `server/` folder: Express + `better-sqlite3` on port 3001,
  run with `tsx`. `vite.config.ts` proxies `/api` → `http://localhost:3001`.

```
server/
  index.ts     # Express app + listen
  routes.ts    # endpoint handlers
  store.ts     # SuggestionStore interface + SqliteSuggestionStore (all SQL)
  validate.ts  # pure payload validation
  db.ts        # opens server/data/islatap.db, applies schema
  cli.ts       # review CLI (talks to store directly, no HTTP)
```

`server/data/` (the `.db` file) is gitignored.

Scripts: `npm run dev:server` (server only), `npm run dev:all` (frontend +
server via `concurrently`), `npm run suggestions` (review CLI). `npm run dev`
is unchanged.

## Picker UX

- Start screen gains a "Suggest a location" ghost button → `suggest` state.
- `SuggestScreen`: full-screen satellite map (same Esri layer, same PR
  `maxBounds` lock as the game), search box top-center, back button.
- **Search:** Photon (photon.komoot.io) autocomplete — debounced 300 ms,
  min 3 chars, results limited to the PR bounding box (bbox param + client
  filter). Dropdown shows name / type / municipality. Selecting a result
  flies the map there, drops a draft pin, and prefills the name field.
  Free, key-free, OSM data; attribution shown in the panel. (Nominatim was
  rejected: its usage policy forbids autocomplete.)
- **Tap:** tapping the map places or moves the draft pin.
- With a pin placed, a form panel appears: **name** (required, 1–80 chars),
  **category** (municipio | landmark | barrio), **note** (optional),
  **submitter** (optional).
- **Soft dedupe:** before submit, check the pin against the bundled 120
  locations using the existing `haversineKm` — within 1 km of an existing
  location, or a normalized-name match (case- and diacritic-insensitive, so
  "Rio Piedras" ≈ "Río Piedras"), shows a "looks like this already exists —
  submit anyway?" warning. Warning only; never blocks.
- Submit → `POST /api/suggestions` → success confirmation → back to start.
- **Offline degradation:** on entering the screen, ping `GET /api/health`;
  if unreachable, show a "suggestions are offline right now" banner and
  disable submit. The map/search remain usable. This makes the frontend
  deployable today with no API behind it.

## Data Model

```sql
CREATE TABLE suggestions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('municipio','landmark','barrio')),
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  note        TEXT,
  submitter   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
```

Server-side validation (in `validate.ts`, pure and unit-tested):

- `lat` ∈ [17.8, 18.6], `lng` ∈ [−68.0, −65.1] (the game's map-lock box)
- `name` trimmed, 1–80 chars; `category` in the enum
- `note` ≤ 500 chars, `submitter` ≤ 60 chars (both optional)

## API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | `{ ok: true }` |
| POST | `/api/suggestions` | validate → insert → 201 with created row; 400 with message on invalid payload |
| GET | `/api/suggestions?status=pending` | list, newest first (status filter optional) |
| PATCH | `/api/suggestions/:id` | body `{ status: 'approved' \| 'rejected' }`; stamps `reviewed_at`; 404 unknown id |

`SuggestionStore` interface: `create(input)`, `list(filter?)`,
`setStatus(id, status)`. `SqliteSuggestionStore` is the only implementation
now; a hosted backend later implements the same interface (Turso client,
Postgres, D1) with no route/validation changes.

## Review Flow (CLI)

- `npm run suggestions` — table of pending suggestions (id, name, category,
  coords, note, age).
- `npm run suggestions -- approve <id>` / `reject <id>`.
- `npm run suggestions -- export` — prints approved suggestions as
  ready-to-paste `GameLocation` entries for `locations.ts` (correct shape,
  next free id). Merging into the dataset stays a deliberate manual step to
  preserve the vetted-dataset guarantee.

The CLI uses the store directly (no HTTP), so it works with the server down.

## Error Handling

- Validation failure → 400 with a human message, shown inline under the form.
- Submit network failure → toast; form state preserved for retry.
- Photon failure/timeout → quiet "search unavailable — tap the map instead"
  hint; tap-to-pin keeps the screen fully functional.
- Duplicate-ish submissions are allowed (soft warning only); the review CLI
  is the backstop.

## Testing

Vitest, alongside the existing 11 tests:

- `validate.ts` — bounds edges, category enum, name-length limits.
- `SqliteSuggestionStore` — CRUD + status transitions against `:memory:`.
- Dedupe helper — distance threshold and name normalization
  (case/diacritics).
- Photon fetch and map interaction: manual QA, consistent with the game's
  existing map testing approach.

## Deployment Path (later)

Frontend needs zero changes (relative `/api` URLs). Options, in rough order
of fit:

1. **Turso** (hosted libSQL/SQLite, generous free tier) — swap
   `SqliteSuggestionStore` for a libSQL-client implementation; run the API
   as Vercel functions or keep Express on a small host.
2. **Fly.io / Railway / Render** — run this exact Express+SQLite server with
   a persistent volume (~$0–5/mo). Least code change of all.
3. **Cloudflare Workers + D1** — D1 is SQLite; would want routes ported to a
   Workers-compatible framework (Hono).
4. **Supabase / Neon** (managed Postgres) — if the app outgrows SQLite;
   implement the store interface over Postgres.

Before any public deploy: add rate limiting (per-IP) and basic abuse
controls on `POST /api/suggestions`, and protect `PATCH`/review endpoints
with an admin token.
