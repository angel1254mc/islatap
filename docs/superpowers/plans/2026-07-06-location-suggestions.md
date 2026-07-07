# Location Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let IslaTap players search for and suggest new game locations from a live PR satellite map; store suggestions in a local SQLite database behind a small Express API with a CLI review queue.

**Architecture:** A new `server/` Express + better-sqlite3 API (port 3001) sits behind a `SuggestionStore` interface so the storage can be swapped for a hosted backend later. The existing Vite frontend gains a `suggest` state that renders a picker screen (Photon autocomplete search + tap-to-pin map + form), calling the API through relative `/api/...` URLs proxied to the server in dev. Maintainer reviews via `npm run suggestions`.

**Tech Stack:** TypeScript (strict), Express, better-sqlite3, tsx, concurrently, supertest (dev), React 19 + react-leaflet (existing), Photon geocoding (photon.komoot.io), Vitest.

## Global Constraints

- **TypeScript strict mode** — root `tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`. All new frontend code (`src/**`) must compile clean under `npm run build` (`tsc --noEmit && vite build`).
- **PR bounds (map-lock box), used everywhere:** lat ∈ [17.8, 18.6], lng ∈ [−68.0, −65.1]. Bbox string form for Photon: `-68.0,17.8,-65.1,18.6` (minLon,minLat,maxLon,maxLat).
- **Categories:** exactly `'municipio' | 'landmark' | 'barrio'`.
- **Suggestion statuses:** exactly `'pending' | 'approved' | 'rejected'`.
- **Server port:** 3001. Frontend calls **relative** `/api/...` only (never hardcode localhost) so deploy needs no frontend change.
- **Brand:** user-facing copy says "IslaTap"; never reintroduce "MapTap".
- **DB file** `server/data/islatap.db` is gitignored; the server creates the `server/data/` dir at startup.
- **Existing tests must stay green:** 11 Vitest tests currently pass. Never break them.

---

### Task 1: Server scaffolding + health endpoint

**Files:**
- Create: `server/db.ts`
- Create: `server/index.ts`
- Create: `server/tsconfig.json`
- Modify: `package.json` (deps + scripts)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `openDb(path: string): Database.Database` from `server/db.ts` — opens (creating parent dir for file paths), applies schema, returns a `better-sqlite3` Database. `':memory:'` is supported and skips dir creation.

- [ ] **Step 1: Install dependencies**

```bash
cd C:/Users/angel/maptap-pr
npm install express better-sqlite3
npm install -D tsx concurrently supertest @types/express @types/better-sqlite3 @types/supertest
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block add (keep existing `dev`, `build`, `preview`, `test`):

```json
"dev:server": "tsx watch server/index.ts",
"dev:all": "concurrently -n web,api -c cyan,magenta \"npm run dev\" \"npm run dev:server\"",
"suggestions": "tsx server/cli.ts"
```

- [ ] **Step 3: Ignore the database directory**

Append to `.gitignore`:

```
# local suggestions database
server/data/
```

- [ ] **Step 4: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["../server", "../src/data/locations.ts"]
}
```

- [ ] **Step 5: Create `server/db.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS suggestions (
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
`;

export function openDb(path: string): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 6: Create `server/index.ts` (health only for now)**

```ts
import express from 'express';
import { openDb } from './db';

const DB_PATH = 'server/data/islatap.db';

const app = express();
app.use(express.json());

// Open the DB now so a bad schema fails fast at startup.
openDb(DB_PATH);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`IslaTap API listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 7: Run the server and verify health**

Run in one terminal: `npm run dev:server`
Then in another: `curl http://localhost:3001/api/health`
Expected: `{"ok":true}` and `server/data/islatap.db` now exists. Stop the server (Ctrl-C).

- [ ] **Step 8: Verify existing tests still pass**

Run: `npm test`
Expected: 11 tests pass (server code is not imported by them).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore server/db.ts server/index.ts server/tsconfig.json
git commit -m "feat(server): scaffold Express + SQLite API with health endpoint"
```

---

### Task 2: Suggestion validation + shared types

**Files:**
- Create: `server/validate.ts`
- Test: `server/validate.test.ts`

**Interfaces:**
- Produces:
  - `type Category = 'municipio' | 'landmark' | 'barrio'`
  - `type SuggestionStatus = 'pending' | 'approved' | 'rejected'`
  - `interface SuggestionInput { name: string; category: Category; lat: number; lng: number; note: string | null; submitter: string | null }`
  - `interface Suggestion extends SuggestionInput { id: number; status: SuggestionStatus; created_at: string; reviewed_at: string | null }`
  - `const PR_BOUNDS = { minLat: 17.8, maxLat: 18.6, minLng: -68.0, maxLng: -65.1 }`
  - `function validateSuggestion(body: unknown): { ok: true; value: SuggestionInput } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

Create `server/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSuggestion } from './validate';

const valid = { name: 'Playa Sucia', category: 'landmark', lat: 17.94, lng: -67.19 };

describe('validateSuggestion', () => {
  it('accepts a valid payload and trims/normalizes optionals', () => {
    const r = validateSuggestion({ ...valid, note: '  nice beach  ', submitter: ' Angel ' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Playa Sucia');
      expect(r.value.note).toBe('nice beach');
      expect(r.value.submitter).toBe('Angel');
    }
  });

  it('defaults missing optionals to null', () => {
    const r = validateSuggestion(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.note).toBeNull();
      expect(r.value.submitter).toBeNull();
    }
  });

  it('rejects a non-object body', () => {
    expect(validateSuggestion(null).ok).toBe(false);
    expect(validateSuggestion('x').ok).toBe(false);
  });

  it('rejects empty and over-long names', () => {
    expect(validateSuggestion({ ...valid, name: '   ' }).ok).toBe(false);
    expect(validateSuggestion({ ...valid, name: 'a'.repeat(81) }).ok).toBe(false);
  });

  it('rejects a bad category', () => {
    expect(validateSuggestion({ ...valid, category: 'city' }).ok).toBe(false);
  });

  it('rejects coordinates outside Puerto Rico', () => {
    expect(validateSuggestion({ ...valid, lat: 25 }).ok).toBe(false);
    expect(validateSuggestion({ ...valid, lng: -70 }).ok).toBe(false);
  });

  it('accepts coordinates exactly on the bounds', () => {
    expect(validateSuggestion({ ...valid, lat: 17.8, lng: -68.0 }).ok).toBe(true);
    expect(validateSuggestion({ ...valid, lat: 18.6, lng: -65.1 }).ok).toBe(true);
  });

  it('rejects over-long note and submitter', () => {
    expect(validateSuggestion({ ...valid, note: 'a'.repeat(501) }).ok).toBe(false);
    expect(validateSuggestion({ ...valid, submitter: 'a'.repeat(61) }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/validate.test.ts`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 3: Write `server/validate.ts`**

```ts
export type Category = 'municipio' | 'landmark' | 'barrio';
export type SuggestionStatus = 'pending' | 'approved' | 'rejected';

export interface SuggestionInput {
  name: string;
  category: Category;
  lat: number;
  lng: number;
  note: string | null;
  submitter: string | null;
}

export interface Suggestion extends SuggestionInput {
  id: number;
  status: SuggestionStatus;
  created_at: string;
  reviewed_at: string | null;
}

export const PR_BOUNDS = { minLat: 17.8, maxLat: 18.6, minLng: -68.0, maxLng: -65.1 };

const CATEGORIES: Category[] = ['municipio', 'landmark', 'barrio'];

type ValidationResult =
  | { ok: true; value: SuggestionInput }
  | { ok: false; error: string };

export function validateSuggestion(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: 'Name must be between 1 and 80 characters.' };
  }

  if (!CATEGORIES.includes(b.category as Category)) {
    return { ok: false, error: 'Category must be municipio, landmark, or barrio.' };
  }
  const category = b.category as Category;

  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!Number.isFinite(lat) || lat < PR_BOUNDS.minLat || lat > PR_BOUNDS.maxLat) {
    return { ok: false, error: 'Latitude is outside Puerto Rico.' };
  }
  if (!Number.isFinite(lng) || lng < PR_BOUNDS.minLng || lng > PR_BOUNDS.maxLng) {
    return { ok: false, error: 'Longitude is outside Puerto Rico.' };
  }

  const noteRaw = b.note == null ? '' : String(b.note).trim();
  if (noteRaw.length > 500) {
    return { ok: false, error: 'Note must be 500 characters or fewer.' };
  }

  const submitterRaw = b.submitter == null ? '' : String(b.submitter).trim();
  if (submitterRaw.length > 60) {
    return { ok: false, error: 'Submitter name must be 60 characters or fewer.' };
  }

  return {
    ok: true,
    value: {
      name,
      category,
      lat,
      lng,
      note: noteRaw.length ? noteRaw : null,
      submitter: submitterRaw.length ? submitterRaw : null,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/validate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/validate.ts server/validate.test.ts
git commit -m "feat(server): add suggestion validation and shared types"
```

---

### Task 3: SQLite store

**Files:**
- Create: `server/store.ts`
- Test: `server/store.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 1); `Suggestion`, `SuggestionInput`, `SuggestionStatus` (Task 2).
- Produces:
  - `interface SuggestionStore { create(input: SuggestionInput): Suggestion; list(status?: SuggestionStatus): Suggestion[]; setStatus(id: number, status: SuggestionStatus): Suggestion | null }`
  - `class SqliteSuggestionStore implements SuggestionStore` — constructor `(db: Database.Database)`.

- [ ] **Step 1: Write the failing test**

Create `server/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from './db';
import { SqliteSuggestionStore } from './store';
import type { SuggestionInput } from './validate';

const input: SuggestionInput = {
  name: 'Faro de Cabo Rojo',
  category: 'landmark',
  lat: 17.937,
  lng: -67.19,
  note: null,
  submitter: null,
};

function freshStore() {
  return new SqliteSuggestionStore(openDb(':memory:'));
}

describe('SqliteSuggestionStore', () => {
  it('creates a suggestion with pending status and an id', () => {
    const store = freshStore();
    const row = store.create(input);
    expect(row.id).toBeGreaterThan(0);
    expect(row.status).toBe('pending');
    expect(row.name).toBe('Faro de Cabo Rojo');
    expect(row.reviewed_at).toBeNull();
    expect(row.created_at).toBeTruthy();
  });

  it('lists newest first and filters by status', () => {
    const store = freshStore();
    const a = store.create({ ...input, name: 'A' });
    const b = store.create({ ...input, name: 'B' });
    expect(store.list().map((r) => r.id)).toEqual([b.id, a.id]);
    store.setStatus(a.id, 'approved');
    expect(store.list('pending').map((r) => r.name)).toEqual(['B']);
    expect(store.list('approved').map((r) => r.name)).toEqual(['A']);
  });

  it('setStatus stamps reviewed_at and returns the row', () => {
    const store = freshStore();
    const row = store.create(input);
    const updated = store.setStatus(row.id, 'rejected');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('rejected');
    expect(updated!.reviewed_at).toBeTruthy();
  });

  it('setStatus returns null for an unknown id', () => {
    const store = freshStore();
    expect(store.setStatus(999, 'approved')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Write `server/store.ts`**

```ts
import type { Database } from 'better-sqlite3';
import type { Suggestion, SuggestionInput, SuggestionStatus } from './validate';

export interface SuggestionStore {
  create(input: SuggestionInput): Suggestion;
  list(status?: SuggestionStatus): Suggestion[];
  setStatus(id: number, status: SuggestionStatus): Suggestion | null;
}

export class SqliteSuggestionStore implements SuggestionStore {
  constructor(private readonly db: Database) {}

  create(input: SuggestionInput): Suggestion {
    const info = this.db
      .prepare(
        `INSERT INTO suggestions (name, category, lat, lng, note, submitter)
         VALUES (@name, @category, @lat, @lng, @note, @submitter)`,
      )
      .run({
        name: input.name,
        category: input.category,
        lat: input.lat,
        lng: input.lng,
        note: input.note,
        submitter: input.submitter,
      });
    return this.get(Number(info.lastInsertRowid))!;
  }

  list(status?: SuggestionStatus): Suggestion[] {
    const rows = status
      ? this.db
          .prepare('SELECT * FROM suggestions WHERE status = ? ORDER BY id DESC')
          .all(status)
      : this.db.prepare('SELECT * FROM suggestions ORDER BY id DESC').all();
    return rows as Suggestion[];
  }

  setStatus(id: number, status: SuggestionStatus): Suggestion | null {
    const info = this.db
      .prepare(`UPDATE suggestions SET status = ?, reviewed_at = datetime('now') WHERE id = ?`)
      .run(status, id);
    if (info.changes === 0) return null;
    return this.get(id);
  }

  private get(id: number): Suggestion | null {
    const row = this.db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);
    return (row as Suggestion) ?? null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/store.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add server/store.ts server/store.test.ts
git commit -m "feat(server): add SqliteSuggestionStore behind SuggestionStore interface"
```

---

### Task 4: API routes

**Files:**
- Create: `server/routes.ts`
- Test: `server/routes.test.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `SuggestionStore` (Task 3); `validateSuggestion` (Task 2).
- Produces: `createRouter(store: SuggestionStore): import('express').Router` mounting:
  - `GET /health` → `{ ok: true }`
  - `POST /suggestions` → 201 with created `Suggestion`; 400 `{ error }` on invalid body
  - `GET /suggestions?status=` → 200 `Suggestion[]`
  - `PATCH /suggestions/:id` body `{ status }` → 200 updated `Suggestion`; 400 bad status; 404 unknown id

- [ ] **Step 1: Write the failing test**

Create `server/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from './db';
import { SqliteSuggestionStore } from './store';
import { createRouter } from './routes';

function makeApp() {
  const store = new SqliteSuggestionStore(openDb(':memory:'));
  const app = express();
  app.use(express.json());
  app.use('/api', createRouter(store));
  return app;
}

const body = { name: 'Cueva Ventana', category: 'landmark', lat: 18.42, lng: -66.79 };

describe('routes', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(makeApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST creates a suggestion (201) then GET lists it', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/suggestions').send(body);
    expect(created.status).toBe(201);
    expect(created.body.id).toBeGreaterThan(0);
    expect(created.body.status).toBe('pending');

    const list = await request(app).get('/api/suggestions?status=pending');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Cueva Ventana');
  });

  it('POST with invalid body returns 400 and a message', async () => {
    const res = await request(makeApp()).post('/api/suggestions').send({ ...body, lat: 99 });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('PATCH updates status', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/suggestions').send(body);
    const res = await request(app)
      .patch(`/api/suggestions/${created.body.id}`)
      .send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('PATCH with a bad status returns 400', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/suggestions').send(body);
    const res = await request(app)
      .patch(`/api/suggestions/${created.body.id}`)
      .send({ status: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('PATCH unknown id returns 404', async () => {
    const res = await request(makeApp())
      .patch('/api/suggestions/999')
      .send({ status: 'approved' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes.test.ts`
Expected: FAIL — cannot find module `./routes`.

- [ ] **Step 3: Write `server/routes.ts`**

```ts
import { Router } from 'express';
import type { SuggestionStore } from './store';
import type { SuggestionStatus } from './validate';
import { validateSuggestion } from './validate';

const STATUSES: SuggestionStatus[] = ['pending', 'approved', 'rejected'];

export function createRouter(store: SuggestionStore): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.post('/suggestions', (req, res) => {
    const result = validateSuggestion(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const created = store.create(result.value);
    res.status(201).json(created);
  });

  router.get('/suggestions', (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !STATUSES.includes(status as SuggestionStatus)) {
      res.status(400).json({ error: 'Invalid status filter.' });
      return;
    }
    res.json(store.list(status as SuggestionStatus | undefined));
  });

  router.patch('/suggestions/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid id.' });
      return;
    }
    const status = (req.body ?? {}).status;
    if (!STATUSES.includes(status)) {
      res.status(400).json({ error: 'Status must be pending, approved, or rejected.' });
      return;
    }
    const updated = store.setStatus(id, status);
    if (!updated) {
      res.status(404).json({ error: 'Suggestion not found.' });
      return;
    }
    res.json(updated);
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routes.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Wire the router into `server/index.ts`**

Replace the whole file with:

```ts
import express from 'express';
import { openDb } from './db';
import { SqliteSuggestionStore } from './store';
import { createRouter } from './routes';

const DB_PATH = 'server/data/islatap.db';

const store = new SqliteSuggestionStore(openDb(DB_PATH));

const app = express();
app.use(express.json());
app.use('/api', createRouter(store));

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`IslaTap API listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 6: Manually verify end-to-end**

Run `npm run dev:server`, then:

```bash
curl -X POST http://localhost:3001/api/suggestions -H "Content-Type: application/json" -d "{\"name\":\"Cueva Ventana\",\"category\":\"landmark\",\"lat\":18.42,\"lng\":-66.79}"
curl "http://localhost:3001/api/suggestions?status=pending"
```

Expected: first returns a 201 JSON row with `"status":"pending"`; second lists it. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add server/routes.ts server/routes.test.ts server/index.ts
git commit -m "feat(server): add suggestions REST routes and wire into app"
```

---

### Task 5: Vite dev proxy

**Files:**
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: dev server proxies `/api/*` → `http://localhost:3001` so the frontend's relative calls reach the API.

- [ ] **Step 1: Add the proxy**

Replace `vite.config.ts` with:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 2: Verify the proxy**

Run `npm run dev:all`. In a browser or curl: `curl http://localhost:5173/api/health`
Expected: `{"ok":true}` (served by Vite, proxied to the API). Stop both.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "chore: proxy /api to the suggestions server in dev"
```

---

### Task 6: Shared map config (refactor)

**Files:**
- Create: `src/lib/mapConfig.ts`
- Modify: `src/components/MapView.tsx`

**Interfaces:**
- Produces from `src/lib/mapConfig.ts`:
  - `const BASE_LAYER_URL: string`
  - `const BASE_LAYER_ATTRIBUTION: string`
  - `const PR_BOUNDS: L.LatLngBounds`
  - `const INITIAL_CENTER: L.LatLngTuple`
  - `const INITIAL_ZOOM: number`, `const MIN_ZOOM: number`, `const MAX_ZOOM: number`
  - `function pinIcon(color: string): L.DivIcon`
- Rationale: the picker map (Task 10) needs the identical base layer, bounds lock, and pin styling as the game map. Extract them so both consume one source.

- [ ] **Step 1: Create `src/lib/mapConfig.ts`**

```ts
import L from 'leaflet';

// Base imagery is isolated here so the provider can be swapped later.
export const BASE_LAYER_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const BASE_LAYER_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';

// Puerto Rico archipelago: main island plus Vieques, Culebra, Mona, Desecheo,
// and Caja de Muertos.
export const PR_BOUNDS = L.latLngBounds([17.8, -68.0], [18.6, -65.1]);
export const INITIAL_CENTER: L.LatLngTuple = [18.22, -66.35];
export const INITIAL_ZOOM = 9;
export const MIN_ZOOM = 9;
export const MAX_ZOOM = 16;

// Leaflet's default icon URLs break under bundlers, so pins are explicit
// divIcons with inline SVG instead.
export function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'pin-icon',
    html: `<svg width="34" height="46" viewBox="0 0 34 46" aria-hidden="true">
      <path d="M17 45C17 45 4 26.6 4 15a13 13 0 1 1 26 0c0 11.6-13 30-13 30z" fill="${color}" stroke="rgba(255,255,255,0.95)" stroke-width="2.5"/>
      <circle cx="17" cy="15" r="5" fill="rgba(255,255,255,0.95)"/>
    </svg>`,
    iconSize: [34, 46],
    iconAnchor: [17, 45],
    tooltipAnchor: [0, -42],
  });
}
```

- [ ] **Step 2: Update `src/components/MapView.tsx` to consume it**

Delete the local `BASE_LAYER_URL`, `BASE_LAYER_ATTRIBUTION`, `PR_BOUNDS`, `INITIAL_CENTER`, `INITIAL_ZOOM`, `MIN_ZOOM`, `MAX_ZOOM`, and `pinIcon` definitions (lines defining those constants and the `pinIcon` function). Replace the top imports so that after `import 'leaflet/dist/leaflet.css';` you add:

```ts
import {
  BASE_LAYER_URL,
  BASE_LAYER_ATTRIBUTION,
  PR_BOUNDS,
  INITIAL_CENTER,
  INITIAL_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  pinIcon,
} from '../lib/mapConfig';
```

Keep the `GUESS_ICON` / `TARGET_ICON` lines (they call `pinIcon(...)`) and everything else unchanged. `L` is still imported for `L.latLngBounds` in `ViewController`.

- [ ] **Step 3: Verify build and tests**

Run: `npm run build`
Expected: clean TypeScript compile + Vite build (no unused-symbol errors).
Run: `npm test`
Expected: 11 game tests + the new server tests all pass.

- [ ] **Step 4: Manually verify the game still renders**

Run `npm run dev`, open the app, start a game, confirm the map, pins, and reveal line look identical to before. Stop.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mapConfig.ts src/components/MapView.tsx
git commit -m "refactor: extract shared Leaflet map config for reuse by picker"
```

---

### Task 7: Duplicate detection helper

**Files:**
- Create: `src/lib/dedupe.ts`
- Test: `src/lib/dedupe.test.ts`

**Interfaces:**
- Consumes: `haversineKm`, `LatLng` (`src/lib/scoring.ts`); `LOCATIONS` (`src/data/locations.ts`).
- Produces:
  - `function normalizeName(name: string): string` — trims, lowercases, strips diacritics.
  - `interface DuplicateMatch { name: string; reason: 'name' | 'distance' }`
  - `function findDuplicate(candidate: { name: string; lat: number; lng: number }): DuplicateMatch | null` — name match wins over distance; distance threshold 1 km.

- [ ] **Step 1: Write the failing test**

Create `src/lib/dedupe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeName, findDuplicate } from './dedupe';

describe('normalizeName', () => {
  it('lowercases, trims, and strips diacritics', () => {
    expect(normalizeName('  Río Piedras ')).toBe('rio piedras');
    expect(normalizeName('Añasco')).toBe('anasco');
  });
});

describe('findDuplicate', () => {
  it('flags a diacritic-insensitive name match', () => {
    const match = findDuplicate({ name: 'anasco', lat: 0, lng: 0 });
    expect(match).not.toBeNull();
    expect(match!.reason).toBe('name');
  });

  it('flags a pin within 1 km of an existing location', () => {
    // Arecibo town seat is at 18.47245, -66.71573.
    const match = findDuplicate({ name: 'Totally New Name', lat: 18.4725, lng: -66.7158 });
    expect(match).not.toBeNull();
    expect(match!.reason).toBe('distance');
  });

  it('returns null for a genuinely new, far-away location', () => {
    // A point in the open ocean south of PR, no name collision.
    expect(findDuplicate({ name: 'Zzz Nonexistent Place', lat: 17.85, lng: -66.0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dedupe.test.ts`
Expected: FAIL — cannot find module `./dedupe`.

- [ ] **Step 3: Write `src/lib/dedupe.ts`**

```ts
import { LOCATIONS } from '../data/locations';
import { haversineKm, type LatLng } from './scoring';

/** Distance under which a pin is treated as a probable duplicate. */
const DUPLICATE_KM = 1;

export function normalizeName(name: string): string {
  // Strip the Unicode combining-diacritical-marks block (U+0300–U+036F) so
  // "Río" matches "Rio".
  const COMBINING_MARKS = /[̀-ͯ]/g;
  return name.trim().toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '');
}

export interface DuplicateMatch {
  name: string;
  reason: 'name' | 'distance';
}

export function findDuplicate(candidate: {
  name: string;
  lat: number;
  lng: number;
}): DuplicateMatch | null {
  const norm = normalizeName(candidate.name);
  if (norm) {
    for (const loc of LOCATIONS) {
      if (normalizeName(loc.name) === norm) {
        return { name: loc.name, reason: 'name' };
      }
    }
  }

  const point: LatLng = { lat: candidate.lat, lng: candidate.lng };
  for (const loc of LOCATIONS) {
    if (haversineKm(point, loc) <= DUPLICATE_KM) {
      return { name: loc.name, reason: 'distance' };
    }
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/dedupe.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dedupe.ts src/lib/dedupe.test.ts
git commit -m "feat: soft duplicate detection against the bundled dataset"
```

---

### Task 8: Photon search client

**Files:**
- Create: `src/lib/photon.ts`
- Test: `src/lib/photon.test.ts`

**Interfaces:**
- Produces:
  - `interface PhotonResult { name: string; lat: number; lng: number; detail: string }`
  - `function buildPhotonUrl(query: string): string`
  - `function parsePhoton(json: unknown): PhotonResult[]` — pulls `[lng,lat]` from GeoJSON, builds `detail` from city/county/state, drops results outside PR bounds.
  - `async function searchPhoton(query: string, signal?: AbortSignal): Promise<PhotonResult[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/photon.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPhotonUrl, parsePhoton } from './photon';

describe('buildPhotonUrl', () => {
  it('encodes the query and includes the PR bbox and bias', () => {
    const url = buildPhotonUrl('cabo rojo');
    expect(url).toContain('q=cabo+rojo');
    expect(url).toContain('bbox=-68');
    expect(url).toContain('lat=18.22');
    expect(url).toContain('limit=8');
  });
});

describe('parsePhoton', () => {
  const feature = (lng: number, lat: number, props: Record<string, unknown>) => ({
    geometry: { coordinates: [lng, lat] },
    properties: props,
  });

  it('maps features to results and builds a detail string', () => {
    const results = parsePhoton({
      features: [feature(-67.15, 18.086, { name: 'Cabo Rojo', county: 'Cabo Rojo', state: 'Puerto Rico' })],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Cabo Rojo', lat: 18.086, lng: -67.15 });
    expect(results[0].detail).toContain('Puerto Rico');
  });

  it('filters out features outside Puerto Rico bounds', () => {
    const results = parsePhoton({
      features: [feature(-74.0, 40.7, { name: 'New York' })],
    });
    expect(results).toHaveLength(0);
  });

  it('tolerates malformed input', () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: [{ properties: {} }] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/photon.test.ts`
Expected: FAIL — cannot find module `./photon`.

- [ ] **Step 3: Write `src/lib/photon.ts`**

```ts
const PHOTON_URL = 'https://photon.komoot.io/api/';

// Bias + bounding box for Puerto Rico (minLon,minLat,maxLon,maxLat).
const PR_VIEW = { lat: 18.22, lon: -66.35, bbox: '-68.0,17.8,-65.1,18.6' };
const PR_BOUNDS = { minLat: 17.8, maxLat: 18.6, minLng: -68.0, maxLng: -65.1 };

export interface PhotonResult {
  name: string;
  lat: number;
  lng: number;
  detail: string;
}

export function buildPhotonUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    lat: String(PR_VIEW.lat),
    lon: String(PR_VIEW.lon),
    bbox: PR_VIEW.bbox,
    limit: '8',
    lang: 'en',
  });
  return `${PHOTON_URL}?${params.toString()}`;
}

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

export function parsePhoton(json: unknown): PhotonResult[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];

  const results: PhotonResult[] = [];
  for (const raw of features as PhotonFeature[]) {
    const coords = raw?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < PR_BOUNDS.minLat || lat > PR_BOUNDS.maxLat) continue;
    if (lng < PR_BOUNDS.minLng || lng > PR_BOUNDS.maxLng) continue;

    const p = raw.properties ?? {};
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Unnamed place';
    const detail = [p.city, p.county, p.state]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(', ');
    results.push({ name, lat, lng, detail });
  }
  return results;
}

export async function searchPhoton(query: string, signal?: AbortSignal): Promise<PhotonResult[]> {
  const res = await fetch(buildPhotonUrl(query), { signal });
  if (!res.ok) throw new Error(`Photon request failed: ${res.status}`);
  return parsePhoton(await res.json());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/photon.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/photon.ts src/lib/photon.test.ts
git commit -m "feat: Photon geocoding client scoped to Puerto Rico"
```

---

### Task 9: Frontend suggestions API client

**Files:**
- Create: `src/lib/suggestions.ts`

**Interfaces:**
- Produces:
  - `interface SuggestionPayload { name: string; category: 'municipio' | 'landmark' | 'barrio'; lat: number; lng: number; note?: string; submitter?: string }`
  - `async function checkHealth(): Promise<boolean>`
  - `async function submitSuggestion(payload: SuggestionPayload): Promise<{ ok: true } | { ok: false; error: string }>`
- Note: uses relative `/api/...`. Not unit-tested (thin fetch wrapper over the network); exercised via manual QA in Task 10.

- [ ] **Step 1: Create `src/lib/suggestions.ts`**

```ts
export interface SuggestionPayload {
  name: string;
  category: 'municipio' | 'landmark' | 'barrio';
  lat: number;
  lng: number;
  note?: string;
  submitter?: string;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

export async function submitSuggestion(
  payload: SuggestionPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? `Request failed (${res.status}).` };
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again later.' };
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: clean compile (module is not yet imported anywhere; the build still type-checks it).

- [ ] **Step 3: Commit**

```bash
git add src/lib/suggestions.ts
git commit -m "feat: frontend client for the suggestions API"
```

---

### Task 10: Suggest screen (picker map + search + form)

**Files:**
- Create: `src/components/PickerMap.tsx`
- Create: `src/components/SuggestScreen.tsx`
- Modify: `src/components/StartScreen.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `mapConfig` (Task 6); `searchPhoton`, `PhotonResult` (Task 8); `findDuplicate` (Task 7); `checkHealth`, `submitSuggestion`, `SuggestionPayload` (Task 9); `LatLng` (scoring).
- Produces:
  - `PickerMap` — props `{ pin: LatLng | null; onPick: (p: LatLng) => void; flyTo: LatLng | null }`.
  - `SuggestScreen` — props `{ onBack: () => void }`.
  - `StartScreen` gains prop `onSuggest: () => void`.
  - `App` gains a `'suggest'` phase.

- [ ] **Step 1: Create `src/components/PickerMap.tsx`**

```tsx
import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BASE_LAYER_URL,
  BASE_LAYER_ATTRIBUTION,
  PR_BOUNDS,
  INITIAL_CENTER,
  INITIAL_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  pinIcon,
} from '../lib/mapConfig';
import type { LatLng } from '../lib/scoring';

const DRAFT_ICON = pinIcon('#ffd166');

function PickHandler({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function FlyController({ flyTo }: { flyTo: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (flyTo) {
      map.flyTo([flyTo.lat, flyTo.lng], 14, { duration: 0.8 });
    }
  }, [flyTo, map]);
  return null;
}

interface PickerMapProps {
  pin: LatLng | null;
  onPick: (p: LatLng) => void;
  flyTo: LatLng | null;
}

export default function PickerMap({ pin, onPick, flyTo }: PickerMapProps) {
  return (
    <MapContainer
      className="map-root"
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      maxBounds={PR_BOUNDS}
      maxBoundsViscosity={1.0}
      zoomControl={false}
    >
      <TileLayer url={BASE_LAYER_URL} attribution={BASE_LAYER_ATTRIBUTION} />
      <ZoomControl position="bottomleft" />
      <PickHandler onPick={onPick} />
      <FlyController flyTo={flyTo} />
      {pin && <Marker position={[pin.lat, pin.lng]} icon={DRAFT_ICON} />}
    </MapContainer>
  );
}
```

- [ ] **Step 2: Create `src/components/SuggestScreen.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import PickerMap from './PickerMap';
import { searchPhoton, type PhotonResult } from '../lib/photon';
import { findDuplicate, type DuplicateMatch } from '../lib/dedupe';
import { checkHealth, submitSuggestion, type SuggestionPayload } from '../lib/suggestions';
import type { LatLng } from '../lib/scoring';

type Category = 'municipio' | 'landmark' | 'barrio';

export default function SuggestScreen({ onBack }: { onBack: () => void }) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PhotonResult[]>([]);
  const [searchError, setSearchError] = useState(false);
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);

  const [pin, setPin] = useState<LatLng | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('landmark');
  const [note, setNote] = useState('');
  const [submitter, setSubmitter] = useState('');

  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    checkHealth().then(setOnline);
  }, []);

  // Debounced Photon autocomplete.
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPhoton(query.trim(), controller.signal)
        .then((r) => {
          setResults(r);
          setSearchError(false);
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') setSearchError(true);
        });
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Re-check duplicates whenever the pin or name changes.
  useEffect(() => {
    if (pin && name.trim()) {
      setDuplicate(findDuplicate({ name, lat: pin.lat, lng: pin.lng }));
    } else {
      setDuplicate(null);
    }
  }, [pin, name]);

  const chooseResult = (r: PhotonResult) => {
    const point = { lat: r.lat, lng: r.lng };
    setPin(point);
    setFlyTo(point);
    setName(r.name);
    setResults([]);
    setQuery(r.name);
  };

  const handleSubmit = async () => {
    if (!pin || !name.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    const payload: SuggestionPayload = {
      name: name.trim(),
      category,
      lat: pin.lat,
      lng: pin.lng,
      note: note.trim() || undefined,
      submitter: submitter.trim() || undefined,
    };
    const result = await submitSuggestion(payload);
    setSubmitting(false);
    if (result.ok) setDone(true);
    else setSubmitError(result.error);
  };

  if (done) {
    return (
      <div className="suggest">
        <div className="suggest__panel suggest__panel--center">
          <h2 className="suggest__title">¡Gracias! 🎉</h2>
          <p className="suggest__lede">
            Your suggestion was sent for review. Approved spots may show up in a future round.
          </p>
          <button type="button" className="btn btn--primary" onClick={onBack}>
            Back to start
          </button>
        </div>
      </div>
    );
  }

  const canSubmit = online === true && !!pin && name.trim().length > 0 && !submitting;

  return (
    <div className="suggest">
      <div className="suggest__map">
        <PickerMap pin={pin} onPick={setPin} flyTo={flyTo} />
      </div>

      <div className="suggest__top">
        <button type="button" className="btn btn--ghost suggest__back" onClick={onBack}>
          ← Back
        </button>
        <div className="suggest__search">
          <input
            className="suggest__input"
            type="text"
            placeholder="Search for a place in Puerto Rico…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searchError && <p className="suggest__hint">Search unavailable — tap the map instead.</p>}
          {results.length > 0 && (
            <ul className="suggest__results">
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button type="button" onClick={() => chooseResult(r)}>
                    <strong>{r.name}</strong>
                    {r.detail && <span>{r.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {online === false && (
        <div className="suggest__banner">
          Suggestions are offline right now. You can still explore the map.
        </div>
      )}

      <div className="suggest__panel">
        {!pin ? (
          <p className="suggest__lede">
            Search above or tap the map to drop a pin on the place you want to suggest.
          </p>
        ) : (
          <>
            <label className="suggest__field">
              <span>Name</span>
              <input
                type="text"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Playa Sucia"
              />
            </label>

            <label className="suggest__field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                <option value="municipio">Municipio</option>
                <option value="landmark">Landmark</option>
                <option value="barrio">Barrio</option>
              </select>
            </label>

            <label className="suggest__field">
              <span>Note (optional)</span>
              <input
                type="text"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why should this be in the game?"
              />
            </label>

            <label className="suggest__field">
              <span>Your name (optional)</span>
              <input
                type="text"
                maxLength={60}
                value={submitter}
                onChange={(e) => setSubmitter(e.target.value)}
              />
            </label>

            {duplicate && (
              <p className="suggest__warn">
                This looks like it may already exist ({duplicate.name}). You can still submit it.
              </p>
            )}
            {submitError && <p className="suggest__error">{submitError}</p>}

            <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? 'Sending…' : 'Suggest this location'}
            </button>
          </>
        )}
        <p className="suggest__attribution">Search by Photon / OpenStreetMap</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the "Suggest a location" button to `src/components/StartScreen.tsx`**

Change the props interface and the button area. Replace the file with:

```tsx
interface StartScreenProps {
  bestScore: number | null;
  onPlay: () => void;
  onSuggest: () => void;
}

export default function StartScreen({ bestScore, onPlay, onSuggest }: StartScreenProps) {
  return (
    <div className="screen">
      <div className="screen__card">
        <p className="screen__kicker">🇵🇷 Puerto Rico Edition</p>
        <h1 className="screen__title">
          Isla<span>Tap</span>
        </h1>
        <p className="screen__lede">
          Five places. One tap each. How well do you really know la Isla del Encanto?
        </p>
        <ul className="screen__rules">
          <li>📍 Read the prompt, then tap the satellite map as close as you can.</li>
          <li>📏 The closer your tap, the more you earn — up to 5,000 points a round.</li>
          <li>🏆 25,000 is a perfect game. ¿Te atreves?</li>
        </ul>
        {bestScore !== null && (
          <div className="best-chip">
            Best score <strong>{bestScore.toLocaleString('en-US')}</strong>
          </div>
        )}
        <div className="screen__actions">
          <button type="button" className="btn btn--primary btn--big" onClick={onPlay}>
            Play
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSuggest}>
            Suggest a location
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the `suggest` phase into `src/App.tsx`**

Make these edits:

1. Add the import near the other component imports:

```ts
import SuggestScreen from './components/SuggestScreen';
```

2. Extend the `Phase` type:

```ts
type Phase = 'start' | 'playing' | 'revealed' | 'results' | 'suggest';
```

3. Update the `StartScreen` render line to pass `onSuggest`:

```tsx
{phase === 'start' && (
  <StartScreen
    bestScore={bestScore}
    onPlay={startGame}
    onSuggest={() => setPhase('suggest')}
  />
)}
```

4. Add the suggest-screen render just after the `phase === 'start'` block:

```tsx
{phase === 'suggest' && <SuggestScreen onBack={() => setPhase('start')} />}
```

- [ ] **Step 5: Add styles to `src/index.css`**

Append at the end of the file:

```css
/* --------------------------- Suggest screen ------------------------- */

.suggest {
  position: absolute;
  inset: 0;
  z-index: 1200;
}

.suggest__map {
  position: absolute;
  inset: 0;
}

.suggest__map .map-root {
  width: 100%;
  height: 100%;
}

.suggest__top {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1300;
  width: min(560px, calc(100% - 24px));
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.suggest__back {
  flex: 0 0 auto;
}

.suggest__search {
  flex: 1;
  position: relative;
}

.suggest__input {
  width: 100%;
  padding: 12px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  font-size: 15px;
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow);
}

.suggest__results {
  list-style: none;
  margin: 6px 0 0;
  padding: 6px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
  max-height: 320px;
  overflow-y: auto;
}

.suggest__results button {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--ink);
  padding: 9px 12px;
  border-radius: 10px;
  cursor: pointer;
}

.suggest__results button:hover {
  background: rgba(255, 255, 255, 0.08);
}

.suggest__results span {
  font-size: 12px;
  color: var(--ink-dim);
}

.suggest__hint {
  margin: 6px 2px 0;
  font-size: 12px;
  color: var(--ink-dim);
}

.suggest__banner {
  position: absolute;
  top: 74px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1300;
  background: rgba(255, 93, 115, 0.16);
  border: 1px solid rgba(255, 93, 115, 0.4);
  color: var(--ink);
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 13px;
}

.suggest__panel {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1300;
  width: min(440px, calc(100% - 24px));
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px 18px;
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow);
  display: grid;
  gap: 10px;
}

.suggest__panel--center {
  bottom: auto;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  gap: 14px;
}

.suggest__title {
  margin: 0;
  font-size: 26px;
}

.suggest__lede {
  margin: 0;
  color: var(--ink-dim);
  line-height: 1.5;
  font-size: 14px;
}

.suggest__field {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.suggest__field input,
.suggest__field select {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.06);
  color: var(--ink);
  font-size: 14px;
  text-transform: none;
  letter-spacing: normal;
}

.suggest__warn {
  margin: 0;
  font-size: 13px;
  color: var(--sun);
}

.suggest__error {
  margin: 0;
  font-size: 13px;
  color: var(--coral);
}

.suggest__attribution {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--ink-dim);
  text-align: center;
}
```

- [ ] **Step 6: Build and type-check**

Run: `npm run build`
Expected: clean compile + Vite build.

- [ ] **Step 7: Manual QA of the full flow**

Run `npm run dev:all`. In the app:
1. On the start screen click **Suggest a location**.
2. Type "Cabo Rojo" — a dropdown appears; click a result; the map flies there and drops a yellow pin; the name field prefills.
3. Also try tapping the map directly — the pin moves.
4. Type a name matching an existing location (e.g. "Arecibo") near its town — the duplicate warning appears but submit stays enabled.
5. Submit — the thank-you panel shows.
6. In a terminal run `curl "http://localhost:3001/api/suggestions?status=pending"` and confirm the row is there.
7. Stop the API only (leave the web server) and reopen the suggest screen — the offline banner shows and submit is disabled.

- [ ] **Step 8: Confirm existing tests still pass**

Run: `npm test`
Expected: all game tests + all server/lib tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/PickerMap.tsx src/components/SuggestScreen.tsx src/components/StartScreen.tsx src/App.tsx src/index.css
git commit -m "feat: location suggestion picker screen (search, tap-to-pin, submit)"
```

---

### Task 11: Review CLI

**Files:**
- Create: `server/cli.ts`

**Interfaces:**
- Consumes: `openDb` (Task 1); `SqliteSuggestionStore` (Task 3); `LOCATIONS` (`src/data/locations.ts`, imported for the next free id in `export`).
- Produces: a command-line tool run via `npm run suggestions [-- <cmd> <arg>]`:
  - no args / `list` → print pending suggestions as a table
  - `approve <id>` / `reject <id>` → set status
  - `export` → print approved suggestions as `GameLocation` lines ready to paste into `locations.ts`

- [ ] **Step 1: Create `server/cli.ts`**

```ts
import { openDb } from './db';
import { SqliteSuggestionStore } from './store';
import { LOCATIONS } from '../src/data/locations';

const DB_PATH = 'server/data/islatap.db';
const store = new SqliteSuggestionStore(openDb(DB_PATH));

const [cmd, arg] = process.argv.slice(2);

function printPending(): void {
  const rows = store.list('pending');
  if (rows.length === 0) {
    console.log('No pending suggestions. 🎉');
    return;
  }
  console.log(`\n${rows.length} pending suggestion(s):\n`);
  for (const r of rows) {
    const coords = `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
    console.log(`#${r.id}  ${r.name}  [${r.category}]  (${coords})  — ${r.created_at}`);
    if (r.note) console.log(`     note: ${r.note}`);
    if (r.submitter) console.log(`     by: ${r.submitter}`);
  }
  console.log('\nApprove: npm run suggestions -- approve <id>');
  console.log('Reject:  npm run suggestions -- reject <id>');
  console.log('Export:  npm run suggestions -- export\n');
}

function setStatus(status: 'approved' | 'rejected'): void {
  const id = Number(arg);
  if (!Number.isInteger(id)) {
    console.error('Usage: npm run suggestions -- ' + status.replace('ed', '') + ' <id>');
    process.exit(1);
  }
  const updated = store.setStatus(id, status);
  if (!updated) {
    console.error(`No suggestion with id ${id}.`);
    process.exit(1);
  }
  console.log(`#${updated.id} "${updated.name}" is now ${updated.status}.`);
}

function exportApproved(): void {
  const rows = store.list('approved');
  if (rows.length === 0) {
    console.log('No approved suggestions to export.');
    return;
  }
  let nextId = LOCATIONS.reduce((max, l) => Math.max(max, l.id), 0) + 1;
  console.log('\n// Paste into src/data/locations.ts (set difficulty per entry):\n');
  for (const r of rows) {
    const name = r.name.replace(/"/g, '\\"');
    console.log(
      `  { id: ${nextId}, name: "${name}", category: '${r.category}', difficulty: 'medium', ` +
        `lat: ${r.lat}, lng: ${r.lng} }, // TODO difficulty; suggestion #${r.id}`,
    );
    nextId += 1;
  }
  console.log('');
}

switch (cmd) {
  case undefined:
  case 'list':
    printPending();
    break;
  case 'approve':
    setStatus('approved');
    break;
  case 'reject':
    setStatus('rejected');
    break;
  case 'export':
    exportApproved();
    break;
  default:
    console.log('Usage: npm run suggestions -- [list|approve <id>|reject <id>|export]');
}
```

- [ ] **Step 2: Manually verify the CLI end-to-end**

Assuming Task 10's manual QA left at least one pending row (if not, POST one via curl first):

```bash
npm run suggestions
npm run suggestions -- approve 1
npm run suggestions -- export
```

Expected: `list` prints the pending table; `approve 1` prints "#1 … is now approved."; `export` prints a `GameLocation` line with the next free id (starting at 121, since the dataset has 120 entries) and a `medium` difficulty placeholder.

- [ ] **Step 3: Commit**

```bash
git add server/cli.ts
git commit -m "feat(server): review CLI for approving and exporting suggestions"
```

---

## Final Verification

- [ ] Run `npm run build` — clean TypeScript + Vite build.
- [ ] Run `npm test` — all tests pass (11 original + validate + store + routes + dedupe + photon).
- [ ] Run `npm run dev:all` and walk the full suggest flow once more (search → pin → submit → offline banner).
- [ ] Run `npm run suggestions` and confirm the review + export commands work.
- [ ] Confirm `git status` is clean and the game itself is unchanged (start → play → results).
