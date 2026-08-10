import { describe, expect, it } from 'vitest';
import type { DailyPuzzle, GuessResult } from './api';
import {
  INITIAL_GAME_STATE,
  gameReducer,
  promptFromDailyRound,
  totalScoreOf,
  type GameState,
} from './round-state';

const PUZZLE: DailyPuzzle = {
  gameDate: '2026-08-05',
  rounds: [
    { roundId: 'r1', ordinal: 1, name: 'Hato Rey', municipio: 'San Juan', category: 'barrio', subtype: 'barrio', difficulty: 'medium' },
    { roundId: 'r2', ordinal: 2, name: 'Adjuntas', municipio: null, category: 'municipio', subtype: 'municipio', difficulty: 'hard' },
  ],
};

const SQUARE: GuessResult['target'] = {
  type: 'SHAPE',
  geometry: [
    [
      [
        [18.0, -66.5],
        [18.0, -66.4],
        [18.1, -66.4],
        [18.1, -66.5],
        [18.0, -66.5],
      ],
    ],
  ],
};

const SHAPE_RESULT: GuessResult = {
  points: 4321,
  distanceKm: 1.5,
  inside: false,
  answer: { lat: 18.05, lng: -66.45, name: 'Hato Rey', municipio: 'San Juan' },
  target: SQUARE,
};

const CIRCLE_RESULT: GuessResult = {
  points: 5000,
  distanceKm: 0,
  inside: true,
  answer: { lat: 18.4708, lng: -66.12399, name: 'El Morro', municipio: null },
  target: { type: 'CIRCLE', radiusKm: 0.15 },
};

const TAP = { lat: 18.2, lng: -66.7 };

/** Drive the reducer through a list of actions from the initial state. */
function run(...actions: Parameters<typeof gameReducer>[1][]): GameState {
  return actions.reduce(gameReducer, INITIAL_GAME_STATE);
}

const LOADED = () => run({ type: 'daily/load-start' }, { type: 'daily/load-ok', puzzle: PUZZLE });

describe('daily load', () => {
  it('goes start -> loading -> playing and keeps the server gameDate', () => {
    expect(run({ type: 'daily/load-start' }).phase).toBe('loading');
    const state = LOADED();
    expect(state.phase).toBe('playing');
    expect(state.gameDate).toBe('2026-08-05');
    expect(state.prompts.map((p) => p.key)).toEqual(['r1', 'r2']);
    expect(state.roundIndex).toBe(0);
    expect(state.outcomes).toEqual([]);
  });

  it('records a load failure without losing the ability to retry', () => {
    const state = run({ type: 'daily/load-start' }, { type: 'daily/load-fail', message: 'offline' });
    expect(state.phase).toBe('load-error');
    expect(state.errorMessage).toBe('offline');
    expect(gameReducer(state, { type: 'daily/load-start' }).phase).toBe('loading');
  });

  it('ignores a puzzle that arrives after the player already moved on', () => {
    const playing = LOADED();
    expect(gameReducer(playing, { type: 'daily/load-ok', puzzle: PUZZLE })).toBe(playing);
  });
});

describe('guess submission', () => {
  it('moves to submitting and remembers which round the tap belongs to', () => {
    const state = gameReducer(LOADED(), { type: 'guess/start', guess: TAP });
    expect(state.phase).toBe('submitting');
    expect(state.pendingGuess).toEqual(TAP);
    expect(state.pendingKey).toBe('r1');
  });

  it('ignores a second tap while a guess is in flight', () => {
    // MapView's ClickHandler fires onGuess for every click while interactive.
    // Two accepted taps would append two outcomes for one round, so the
    // running total would double-count and the game would end a round early.
    const submitting = gameReducer(LOADED(), { type: 'guess/start', guess: TAP });
    const second = gameReducer(submitting, { type: 'guess/start', guess: { lat: 18.3, lng: -66.1 } });
    expect(second).toBe(submitting);
  });

  it('appends exactly one outcome and reveals, flattening a SHAPE target', () => {
    const state = run(
      { type: 'daily/load-start' },
      { type: 'daily/load-ok', puzzle: PUZZLE },
      { type: 'guess/start', guess: TAP },
      { type: 'guess/ok', key: 'r1', result: SHAPE_RESULT },
    );
    expect(state.phase).toBe('revealed');
    expect(state.outcomes).toHaveLength(1);
    const outcome = state.outcomes[0];
    expect(outcome.key).toBe('r1');
    expect(outcome.name).toBe('Hato Rey');
    expect(outcome.municipio).toBe('San Juan');
    expect(outcome.subtype).toBe('barrio');
    expect(outcome.guess).toEqual(TAP);
    expect(outcome.points).toBe(4321);
    expect(outcome.shape).toEqual(SQUARE.geometry);
    expect(outcome.acceptRadiusKm).toBeNull();
    expect(state.pendingGuess).toBeNull();
    expect(state.pendingKey).toBeNull();
  });

  it('flattens a CIRCLE target into acceptRadiusKm with no shape', () => {
    const state = run(
      { type: 'daily/load-start' },
      { type: 'daily/load-ok', puzzle: PUZZLE },
      { type: 'guess/start', guess: TAP },
      { type: 'guess/ok', key: 'r1', result: CIRCLE_RESULT },
    );
    expect(state.outcomes[0].shape).toBeNull();
    expect(state.outcomes[0].acceptRadiusKm).toBe(0.15);
    expect(state.outcomes[0].inside).toBe(true);
  });

  it('drops a response for a round it is not waiting on', () => {
    const submitting = gameReducer(LOADED(), { type: 'guess/start', guess: TAP });
    const stale = gameReducer(submitting, { type: 'guess/ok', key: 'r2', result: SHAPE_RESULT });
    expect(stale).toBe(submitting);
  });

  it('ignores a response that arrives after the round already resolved', () => {
    const revealed = run(
      { type: 'daily/load-start' },
      { type: 'daily/load-ok', puzzle: PUZZLE },
      { type: 'guess/start', guess: TAP },
      { type: 'guess/ok', key: 'r1', result: SHAPE_RESULT },
    );
    expect(gameReducer(revealed, { type: 'guess/ok', key: 'r1', result: CIRCLE_RESULT })).toBe(revealed);
    expect(revealed.outcomes).toHaveLength(1);
  });
});

describe('guess failure and retry', () => {
  it('keeps the tapped point and appends nothing', () => {
    const state = run(
      { type: 'daily/load-start' },
      { type: 'daily/load-ok', puzzle: PUZZLE },
      { type: 'guess/start', guess: TAP },
      { type: 'guess/fail', key: 'r1', message: 'offline' },
    );
    expect(state.phase).toBe('guess-error');
    expect(state.errorMessage).toBe('offline');
    expect(state.outcomes).toEqual([]);
    // Losing the tap would force the player to guess the same spot twice.
    expect(state.pendingGuess).toEqual(TAP);
  });

  it('resubmits the same point on retry', () => {
    const failed = run(
      { type: 'daily/load-start' },
      { type: 'daily/load-ok', puzzle: PUZZLE },
      { type: 'guess/start', guess: TAP },
      { type: 'guess/fail', key: 'r1', message: 'offline' },
    );
    const retrying = gameReducer(failed, { type: 'guess/retry' });
    expect(retrying.phase).toBe('submitting');
    expect(retrying.pendingGuess).toEqual(TAP);
    expect(retrying.pendingKey).toBe('r1');
    expect(retrying.errorMessage).toBeNull();
  });

  it('ignores a failure for a round it is not waiting on', () => {
    const submitting = gameReducer(LOADED(), { type: 'guess/start', guess: TAP });
    expect(gameReducer(submitting, { type: 'guess/fail', key: 'r2', message: 'x' })).toBe(submitting);
  });
});

describe('round advance', () => {
  it('advances while rounds remain and finishes on the last one', () => {
    const afterFirst = run(
      { type: 'daily/load-start' },
      { type: 'daily/load-ok', puzzle: PUZZLE },
      { type: 'guess/start', guess: TAP },
      { type: 'guess/ok', key: 'r1', result: SHAPE_RESULT },
      { type: 'round/next' },
    );
    expect(afterFirst.phase).toBe('playing');
    expect(afterFirst.roundIndex).toBe(1);

    const done = [
      { type: 'guess/start', guess: TAP } as const,
      { type: 'guess/ok', key: 'r2', result: CIRCLE_RESULT } as const,
      { type: 'round/next' } as const,
    ].reduce(gameReducer, afterFirst);
    expect(done.phase).toBe('results');
    expect(done.outcomes).toHaveLength(2);
  });

  it('does nothing unless a round is actually revealed', () => {
    const playing = LOADED();
    expect(gameReducer(playing, { type: 'round/next' })).toBe(playing);
  });
});

describe('helpers', () => {
  it('sums points', () => {
    expect(totalScoreOf([])).toBe(0);
    expect(
      totalScoreOf([
        { key: 'a', name: 'A', municipio: null, points: 100, distanceKm: 1, inside: false },
        { key: 'b', name: 'B', municipio: null, points: 250, distanceKm: 2, inside: false },
      ]),
    ).toBe(350);
  });

  it('turns a daily round into a prompt with no coordinates on it', () => {
    const prompt = promptFromDailyRound(PUZZLE.rounds[0]);
    expect(prompt).toEqual({
      key: 'r1',
      name: 'Hato Rey',
      municipio: 'San Juan',
      category: 'barrio',
      subtype: 'barrio',
      difficulty: 'medium',
    });
  });
});
