import type { Category, Difficulty, Subtype } from '../data/types';
import type { DailyPuzzle, DailyRound, GuessResult } from './api';
import type { LatLng, MultiPolygon } from './scoring';

/**
 * Everything the HUD needs to pose one round — and deliberately nothing else.
 * There is no lat/lng and no geoid here because this object is built straight
 * from the daily payload, which must never carry the answer.
 *
 * `key` is the value React keys the prompt on (which is what restarts the
 * per-round CSS animation) and, for the daily mode, is also the opaque
 * roundId the guess endpoint is called with.
 *
 * subtype and difficulty are optional here even though DailyRound requires
 * them: practice mode builds prompts from GameLocation rows, and a future
 * prompt source may not carry a difficulty at all. The HUD tests presence.
 */
export interface PromptView {
  key: string;
  name: string;
  municipio: string | null;
  category: Category;
  subtype?: Subtype;
  difficulty?: Difficulty;
}

/**
 * One row of the final scoreboard. Split out from PlayedRound because the
 * results screen and the share text need only this much, which lets a
 * completed game be persisted and replayed from storage without keeping a
 * megabyte of boundary geometry around.
 */
export interface ResultRow {
  key: string;
  name: string;
  municipio: string | null;
  subtype?: Subtype;
  points: number;
  distanceKm: number;
  inside: boolean;
}

/**
 * A scored round plus the extra data the map reveal needs.
 *
 * `shape` and `acceptRadiusKm` come from the same guess response that produced
 * `points`, so the drawn polygon can never disagree with the score. That used
 * to be guaranteed by capturing the shape at guess time from a client-side
 * dictionary; now it is guaranteed by the server sending back the very
 * geometry it measured against.
 */
export interface PlayedRound extends ResultRow {
  guess: LatLng;
  answer: { lat: number; lng: number; name: string; municipio: string | null };
  shape: MultiPolygon | null;
  acceptRadiusKm: number | null;
}

export type Phase =
  | 'start'
  | 'loading'
  | 'load-error'
  | 'playing'
  | 'submitting'
  | 'guess-error'
  | 'revealed'
  | 'results';

export interface GameState {
  phase: Phase;
  mode: 'daily' | 'practice';
  gameDate: string | null;
  prompts: PromptView[];
  roundIndex: number;
  outcomes: PlayedRound[];
  /** The tapped point awaiting — or having failed — a server answer. */
  pendingGuess: LatLng | null;
  /** Which round the in-flight guess belongs to; stale responses are dropped. */
  pendingKey: string | null;
  errorMessage: string | null;
}

export type GameAction =
  | { type: 'daily/load-start' }
  | { type: 'daily/load-ok'; puzzle: DailyPuzzle }
  | { type: 'daily/load-fail'; message: string }
  | { type: 'practice/load-start' }
  | { type: 'practice/ready'; prompts: PromptView[] }
  | { type: 'guess/start'; guess: LatLng }
  | { type: 'guess/ok'; key: string; result: GuessResult }
  | { type: 'guess/resolved'; key: string; outcome: PlayedRound }
  | { type: 'guess/fail'; key: string; message: string }
  | { type: 'guess/retry' }
  | { type: 'round/next' };

export const INITIAL_GAME_STATE: GameState = {
  phase: 'start',
  mode: 'daily',
  gameDate: null,
  prompts: [],
  roundIndex: 0,
  outcomes: [],
  pendingGuess: null,
  pendingKey: null,
  errorMessage: null,
};

export function promptFromDailyRound(round: DailyRound): PromptView {
  // Copied field by field rather than spread: DailyRound is the wire type and
  // may grow fields the HUD has no business seeing, and a spread would carry
  // them silently.
  return {
    key: round.roundId,
    name: round.name,
    municipio: round.municipio,
    category: round.category,
    subtype: round.subtype,
    difficulty: round.difficulty,
  };
}

/**
 * Whether a guess resolution should be applied at all.
 *
 * A response for anything other than the round we are waiting on is stale — a
 * retry that raced its own first attempt, or a reply that outlived its round.
 * Dropping it keeps outcomes[] at exactly one entry per played round, which is
 * the invariant totalScore depends on.
 *
 * Daily (`guess/ok`), practice (`guess/resolved`) and failure (`guess/fail`)
 * all route through this one predicate on purpose. Three copies of the same
 * two comparisons agree only until someone hardens one and forgets the others.
 */
function acceptsResolution(state: GameState, key: string): boolean {
  return state.phase === 'submitting' && key === state.pendingKey;
}

function playedRound(prompt: PromptView, guess: LatLng, result: GuessResult): PlayedRound {
  const row: PlayedRound = {
    key: prompt.key,
    name: prompt.name,
    municipio: prompt.municipio,
    guess,
    answer: result.answer,
    distanceKm: result.distanceKm,
    points: result.points,
    inside: result.inside,
    // The SHAPE/CIRCLE union is flattened here into the two nullable fields
    // MapView already draws from, so the map component keeps one shape of
    // props whether the round came from the server or from practice mode.
    shape: result.target.type === 'SHAPE' ? result.target.geometry : null,
    acceptRadiusKm: result.target.type === 'CIRCLE' ? result.target.radiusKm : null,
  };
  // Written conditionally so the row has no `subtype` key at all when the
  // prompt had none, rather than an explicit undefined that JSON.stringify
  // would drop anyway but deep-equality assertions would not.
  if (prompt.subtype) row.subtype = prompt.subtype;
  return row;
}

export function totalScoreOf(outcomes: readonly ResultRow[]): number {
  return outcomes.reduce((sum, outcome) => sum + outcome.points, 0);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'daily/load-start':
      // A full reset, not a patch: this is also the retry path out of
      // 'load-error', and a half-cleared state there would show yesterday's
      // prompts under today's spinner.
      return { ...INITIAL_GAME_STATE, mode: 'daily', phase: 'loading' };

    case 'daily/load-ok': {
      if (state.phase !== 'loading') return state;
      return {
        ...state,
        phase: 'playing',
        gameDate: action.puzzle.gameDate,
        prompts: action.puzzle.rounds.map(promptFromDailyRound),
        roundIndex: 0,
        outcomes: [],
        errorMessage: null,
      };
    }

    case 'daily/load-fail':
      if (state.phase !== 'loading') return state;
      return { ...state, phase: 'load-error', errorMessage: action.message };

    case 'practice/load-start':
      // Practice shares the loading phase even though nothing is fetched from a
      // server: the location table is code-split out of the main bundle, so
      // there is a real (if short) await before the first prompt exists.
      return { ...INITIAL_GAME_STATE, mode: 'practice', phase: 'loading' };

    case 'practice/ready':
      if (state.phase !== 'loading') return state;
      return {
        ...state,
        phase: 'playing',
        // Deliberately no gameDate: practice is unscored and untimed, and a
        // date here would let a practice run be written into the daily history
        // and inflate a streak.
        gameDate: null,
        prompts: action.prompts,
        roundIndex: 0,
        outcomes: [],
        errorMessage: null,
      };

    case 'guess/start': {
      // Only a live round accepts a tap. Rejecting from 'submitting' is the
      // double-tap guard: the map's click handler fires on every click while
      // interactive, and a second accepted tap would append a second outcome
      // for the same round — double-counting the score and ending the game
      // one round early.
      if (state.phase !== 'playing') return state;
      const current = state.prompts[state.roundIndex];
      if (!current) return state;
      return {
        ...state,
        phase: 'submitting',
        pendingGuess: action.guess,
        pendingKey: current.key,
        errorMessage: null,
      };
    }

    case 'guess/ok': {
      if (!acceptsResolution(state, action.key)) return state;
      const prompt = state.prompts[state.roundIndex];
      const guess = state.pendingGuess;
      if (!prompt || !guess) return state;
      return {
        ...state,
        phase: 'revealed',
        outcomes: [...state.outcomes, playedRound(prompt, guess, action.result)],
        pendingGuess: null,
        pendingKey: null,
        errorMessage: null,
      };
    }

    case 'guess/resolved': {
      // Practice scores locally, so it hands the reducer a finished round
      // instead of a server response — but it goes through the same
      // acceptsResolution() check, so the double-tap and wrong-round guards
      // apply identically in both modes.
      if (!acceptsResolution(state, action.key)) return state;
      // The daily path rebuilds its row from state.prompts, so it cannot append
      // a row belonging to another round. Practice supplies the row ready-made,
      // so the same guarantee has to be checked rather than constructed.
      const prompt = state.prompts[state.roundIndex];
      if (!prompt || action.outcome.key !== prompt.key) return state;
      return {
        ...state,
        phase: 'revealed',
        outcomes: [...state.outcomes, action.outcome],
        pendingGuess: null,
        pendingKey: null,
        errorMessage: null,
      };
    }

    case 'guess/fail':
      if (!acceptsResolution(state, action.key)) return state;
      // pendingGuess survives on purpose: the player tapped a specific pixel
      // and should not have to reproduce it because the network blinked.
      return { ...state, phase: 'guess-error', errorMessage: action.message };

    case 'guess/retry':
      if (state.phase !== 'guess-error' || !state.pendingGuess) return state;
      return { ...state, phase: 'submitting', errorMessage: null };

    case 'round/next': {
      if (state.phase !== 'revealed') return state;
      const next = state.roundIndex + 1;
      if (next >= state.prompts.length) return { ...state, phase: 'results' };
      return { ...state, phase: 'playing', roundIndex: next };
    }

    default:
      return state;
  }
}
