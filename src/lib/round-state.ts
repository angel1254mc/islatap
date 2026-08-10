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
  | { type: 'guess/start'; guess: LatLng }
  | { type: 'guess/ok'; key: string; result: GuessResult }
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
      if (state.phase !== 'submitting') return state;
      // A response for anything other than the round we are waiting on is
      // stale — a retry that raced its own first attempt, or a reply that
      // outlived its round. Dropping it keeps outcomes[] at exactly one entry
      // per played round, which is the invariant totalScore depends on.
      if (action.key !== state.pendingKey) return state;
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

    case 'guess/fail':
      if (state.phase !== 'submitting' || action.key !== state.pendingKey) return state;
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
