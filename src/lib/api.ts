import type { Category, Difficulty, Subtype } from '../data/types';
import type {
  DailyPayload,
  DailyRound,
  GuessAnswer,
  GuessResponse,
  GuessTarget,
} from './api-types';
import type { LatLng, MultiPolygon } from './scoring';

/**
 * The wire contract lives in exactly one place.
 *
 * `src/lib/target.ts` owns GuessTarget (the server scores against it, so the
 * scorer is its natural home); `src/lib/api-types.ts` owns everything else and
 * re-exports GuessTarget. Both api/daily.ts and api/guess.ts import from
 * api-types too, which is what makes a mismatch between what the server sends
 * and what the browser expects a compile error rather than a 3am bug report.
 *
 * This module therefore declares NO shapes of its own — it only renames a few
 * of them to the vocabulary the UI already speaks ("puzzle", "result").
 */
export type { DailyRound, GuessTarget, GuessAnswer };
export type DailyPuzzle = DailyPayload;
export type GuessResult = GuessResponse;

/**
 * The only two network surfaces the game has. Both are Vercel serverless
 * functions living next to the static Vite build, so they are same-origin and
 * need no base URL, no CORS handling and no credentials.
 */
export const DAILY_ENDPOINT = '/api/daily';
export const GUESS_ENDPOINT = '/api/guess';

/**
 * A cold serverless function plus a cold Postgres connection can take a couple
 * of seconds; ten is generous enough to never fire on a healthy request and
 * short enough that a dead network shows an error instead of a spinner that
 * hangs until the browser's own (often 300 s) default gives up.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'malformed';

/**
 * Which endpoint a failed request was for. Carried on the error purely so
 * userMessage() can give the same HTTP status different copy depending on
 * what failed: a 404 from /api/daily means today's puzzle has not been
 * published yet, but a 404 from /api/guess means the roundId itself is
 * unknown (api/guess.ts's 'unknown-round') — a stale tab, not an unready day.
 * Null for errors raised while parsing a response body, since a malformed
 * payload does not need the distinction.
 */
export type ApiRequestContext = 'daily' | 'guess';

/**
 * One error type for every failure mode so callers can branch on `kind`
 * instead of sniffing message strings. `status` is only meaningful for
 * kind === 'http'.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly context: ApiRequestContext | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    context: ApiRequestContext | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.context = context;
  }
}

/** Player-facing copy. Never surface `error.message` — it is developer text. */
export function userMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'timeout':
        return 'The server is taking too long to answer. Check your connection and try again.';
      case 'network':
        return 'No connection to the server. Check your network and try again.';
      case 'http':
        if (error.status === 404) {
          // /api/guess 404s when a roundId no longer exists — a different
          // failure from /api/daily simply not having today's puzzle yet, so
          // it gets its own copy instead of reusing "not ready yet".
          return error.context === 'guess'
            ? 'That round is no longer available. Reload to get today’s puzzle.'
            : 'Today’s puzzle is not ready yet. Try again in a moment.';
        }
        return `The server hit an error (${error.status ?? '?'}). Try again.`;
      case 'malformed':
        return 'The server sent something unexpected. Try again.';
    }
  }
  return 'Something went wrong. Try again.';
}

// --------------------------- shape checking ---------------------------
//
// Zod validates the request body on the server. On the client we hand-roll the
// response checks instead: the repo keeps exactly four runtime dependencies,
// and these payloads are small and fully known. The checks are not paranoia
// for its own sake — an unvalidated `points` of null (which is what
// JSON.stringify does to NaN) would flow straight into the running total and
// turn every subsequent round's score into NaN.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const CATEGORIES: readonly string[] = ['municipio', 'landmark', 'barrio'];
const SUBTYPES: readonly string[] = ['municipio', 'landmark', 'barrio', 'barrio-pueblo', 'comunidad'];
const DIFFICULTIES: readonly string[] = ['easy', 'medium', 'hard'];

// Keys that must never appear on a prompt. Listed explicitly so that adding a
// field to the server response can never silently widen what the client trusts.
const FORBIDDEN_ROUND_KEYS: readonly string[] = ['lat', 'lng', 'geoid', 'radiusKm', 'locationId', 'id'];

function bad(message: string): never {
  throw new ApiError('malformed', message);
}

function parseDailyRound(value: unknown, index: number): DailyRound {
  if (!isRecord(value)) bad(`Round ${index} was not an object`);

  const leaked = FORBIDDEN_ROUND_KEYS.filter((key) => key in value);
  if (leaked.length > 0) {
    // Not fatal — the game still plays — but this is a live cheat vector, so
    // it must be visible in any console anyone happens to have open.
    console.warn(
      `/api/daily leaked answer-bearing fields on round ${index}: ${leaked.join(', ')}. ` +
        'Stripping them client-side, but the server must stop sending them.',
    );
  }

  const { roundId, ordinal, name, municipio, category, subtype, difficulty } = value;
  if (typeof roundId !== 'string' || roundId.length === 0) bad(`Round ${index} has no roundId`);
  if (!finiteNumber(ordinal)) bad(`Round ${index} has no ordinal`);
  if (typeof name !== 'string' || name.length === 0) bad(`Round ${index} has no name`);
  if (municipio !== null && typeof municipio !== 'string') bad(`Round ${index} has a bad municipio`);
  if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
    bad(`Round ${index} has an unknown category`);
  }
  // Required, not decorative-and-optional: api/daily.ts selects both columns
  // on every row it returns, so their absence means the payload is not from
  // the endpoint this client is written against. Tolerating it would leave
  // DailyRound claiming a Subtype that is actually undefined.
  if (typeof subtype !== 'string' || !SUBTYPES.includes(subtype)) {
    bad(`Round ${index} has an unknown subtype`);
  }
  if (typeof difficulty !== 'string' || !DIFFICULTIES.includes(difficulty)) {
    bad(`Round ${index} has an unknown difficulty`);
  }

  // Built key by key rather than spread, so the returned object provably
  // contains nothing beyond this list even if the server sent more.
  return {
    roundId,
    ordinal,
    name,
    municipio,
    category: category as Category,
    subtype: subtype as Subtype,
    difficulty: difficulty as Difficulty,
  };
}

export function parseDailyPuzzle(value: unknown): DailyPuzzle {
  if (!isRecord(value)) bad('Daily puzzle was not an object');
  const { gameDate, rounds } = value;
  // Exact 'YYYY-MM-DD'. The client keys its localStorage history by this
  // string, so a loose format would silently fragment a player's streak.
  if (typeof gameDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
    bad('Daily puzzle has no valid gameDate');
  }
  if (!Array.isArray(rounds) || rounds.length === 0) bad('Daily puzzle has no rounds');
  return { gameDate, rounds: rounds.map(parseDailyRound) };
}

/**
 * MultiPolygon is Ring[][] and a Ring point is the tuple [lat, lng] — Leaflet's
 * order, the inverse of GeoJSON's. Everything downstream indexes [0] as
 * latitude, so this checks the nesting depth (part -> ring -> point -> number)
 * and nothing more; it deliberately does not reorder or normalise.
 */
function isMultiPolygon(value: unknown): value is MultiPolygon {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    Array.isArray(value[0]) &&
    Array.isArray(value[0][0]) &&
    Array.isArray(value[0][0][0]) &&
    finiteNumber(value[0][0][0][0])
  );
}

function parseTarget(value: unknown): GuessTarget {
  if (!isRecord(value)) bad('Guess result has no target');
  if (value.type === 'SHAPE') {
    if (!isMultiPolygon(value.geometry)) bad('SHAPE target has malformed geometry');
    return { type: 'SHAPE', geometry: value.geometry };
  }
  if (value.type === 'CIRCLE') {
    if (!finiteNumber(value.radiusKm) || value.radiusKm <= 0) {
      bad('CIRCLE target has a non-positive radiusKm');
    }
    return { type: 'CIRCLE', radiusKm: value.radiusKm };
  }
  bad('Guess result target is neither SHAPE nor CIRCLE');
}

export function parseGuessResult(value: unknown): GuessResult {
  if (!isRecord(value)) bad('Guess result was not an object');
  const { points, distanceKm, inside, answer, target } = value;
  if (!finiteNumber(points)) bad('Guess result has no numeric points');
  if (!finiteNumber(distanceKm)) bad('Guess result has no numeric distanceKm');
  if (typeof inside !== 'boolean') bad('Guess result has no boolean inside');
  if (!isRecord(answer)) bad('Guess result has no answer');
  if (!finiteNumber(answer.lat) || !finiteNumber(answer.lng)) bad('Answer has no coordinates');
  if (typeof answer.name !== 'string') bad('Answer has no name');
  if (answer.municipio !== null && typeof answer.municipio !== 'string') {
    bad('Answer has a bad municipio');
  }
  return {
    points,
    distanceKm,
    inside,
    answer: { lat: answer.lat, lng: answer.lng, name: answer.name, municipio: answer.municipio },
    target: parseTarget(target),
  };
}

// ------------------------------ transport -----------------------------

async function requestJson(url: string, init: RequestInit, context: ApiRequestContext): Promise<unknown> {
  const controller = new AbortController();
  // ReturnType<typeof setTimeout> rather than `number`: the same source is
  // typechecked with the DOM lib today and may be typechecked with Node's
  // globals tomorrow, and the two disagree about this return type.
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    // fetch rejects for both a dead network and our own abort; only the
    // signal can tell them apart, and they need different copy.
    throw controller.signal.aborted
      ? new ApiError('timeout', `${url} timed out after ${REQUEST_TIMEOUT_MS} ms`, null, context)
      : new ApiError('network', `${url} could not be reached: ${String(cause)}`, null, context);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ApiError('http', `${url} returned HTTP ${response.status}`, response.status, context);
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError('malformed', `${url} did not return JSON`, null, context);
  }
}

/**
 * Puerto Rico: Atlantic Standard Time, UTC-4, no DST anywhere in the year —
 * matching api/_lib/date.ts, which is the server's source of truth for
 * gameDate. This client-side copy exists only to decide whether a *cached*
 * puzzle might be stale; the server, not this function, decides what today's
 * actual gameDate is.
 */
const GAME_TIME_ZONE = 'America/Puerto_Rico';

function todayInAst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: GAME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * One in-flight daily request per page load.
 *
 * React 19 StrictMode double-invokes mount effects in development, and the
 * start screen may also want the puzzle before the player presses Play, so
 * without memoisation the same puzzle is fetched two or three times. Mirrors
 * the `loadPromise ??=` pattern already used by src/lib/shapes.ts.
 *
 * The memo is cleared on failure — otherwise a retry after a dropped
 * connection would keep re-awaiting the same rejected promise forever.
 *
 * It is also cleared across an AST calendar-day boundary. `dailyPromiseAstDate`
 * records todayInAst() at the moment the request was issued (deliberately NOT
 * the resolved puzzle's own `gameDate` — that would tie cache validity to
 * what a mock or a clock-skewed server claims rather than to this client's own
 * clock), and a later call noticing the date has moved on drops the memo
 * before touching it. Without this, a tab left open past midnight AST — say,
 * sitting on the results screen after finishing at 11:58 pm — would hand
 * "Play again" the exact same (now yesterday's) puzzle it served hours
 * earlier, because nothing had ever invalidated the promise.
 */
let dailyPromise: Promise<DailyPuzzle> | null = null;
let dailyPromiseAstDate: string | null = null;

export function fetchDaily(): Promise<DailyPuzzle> {
  const today = todayInAst();
  if (dailyPromiseAstDate !== null && dailyPromiseAstDate !== today) {
    dailyPromise = null;
    dailyPromiseAstDate = null;
  }
  if (dailyPromise === null) {
    dailyPromiseAstDate = today;
  }
  dailyPromise ??= requestJson(
    DAILY_ENDPOINT,
    { method: 'GET', headers: { accept: 'application/json' } },
    'daily',
  )
    .then(parseDailyPuzzle)
    .catch((error: unknown) => {
      dailyPromise = null;
      dailyPromiseAstDate = null;
      throw error;
    });
  return dailyPromise;
}

/**
 * Submit one guess. The endpoint is a pure function with zero writes, so it is
 * safe to call twice for the same round (a duplicate request from a StrictMode
 * double-effect just returns the same answer).
 */
export function submitGuess(roundId: string, guess: LatLng): Promise<GuessResult> {
  return requestJson(
    GUESS_ENDPOINT,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ roundId, lat: guess.lat, lng: guess.lng }),
    },
    'guess',
  ).then(parseGuessResult);
}

/**
 * A guess body /api/guess is guaranteed to reject.
 *
 * `roundId` is not a uuid and {0, 0} sits far outside the Puerto Rico
 * envelope, so guessBodySchema rejects it twice over. That is the whole point:
 * api/guess.ts validates BEFORE the round lookup, so this request warms the
 * function without ever reaching the database. api/guess.test.ts asserts
 * exactly that against the real handler, which is what keeps this safe if the
 * schema is ever loosened.
 *
 * An object rather than a pre-serialised string, so warmGuess and that test
 * stringify the same value and cannot drift apart.
 */
export const WARM_GUESS_BODY = { roundId: 'warm', lat: 0, lng: 0 } as const;

/**
 * Whether this page load has already warmed the guess function.
 *
 * Set before the request rather than after it, so a failed warm-up is not
 * retried. There is nothing to gain by retrying: the player's next real guess
 * pays the cold start regardless, and a retry loop against a dead network
 * would be worse than doing nothing.
 */
let guessWarmed = false;

/**
 * Try to pay the guess function's cold start before the player's first tap.
 *
 * /api/daily and /api/guess are separate Vercel functions, so fetching the
 * puzzle warms neither the guess lambda nor its module graph (zod,
 * src/lib/target.ts, src/lib/scoring.ts). Firing a request the handler is
 * certain to reject moves that cost off the critical path and into the seconds
 * the player spends reading the first prompt — that is the intent, not a
 * measured result. On the deployed preview this could not be shown to save
 * anything: the warm-up returns 400 without touching the database, so its
 * ~90ms isn't comparable to a real guess's ~228ms, and a true cold-vs-cold
 * comparison wasn't constructible because Vercel may already warm a function
 * during deployment. The guess lambda's own cold start does appear small; the
 * first-load cost that measurably matters is Neon's compute waking (1160ms
 * cold, 107ms warm), which /api/daily already absorbs on its own.
 *
 * Not a GET: api/guess.ts exports only POST and Vercel routes by method, so a
 * GET may be answered 405 by the platform dispatcher without ever entering the
 * module — which is the cold start being paid down.
 *
 * Never rejects. The 400 is the expected outcome, not a failure.
 */
export function warmGuess(): Promise<void> {
  if (guessWarmed) return Promise.resolve();
  guessWarmed = true;
  return requestJson(
    GUESS_ENDPOINT,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(WARM_GUESS_BODY),
    },
    'guess',
  ).then(
    () => undefined,
    () => undefined,
  );
}

/** Test seam: drops the daily memo so each test starts from a cold client. */
export function resetApiForTest(): void {
  dailyPromise = null;
  dailyPromiseAstDate = null;
  guessWarmed = false;
}
