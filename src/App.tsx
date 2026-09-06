import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import GuessError from './components/GuessError';
import MapView from './components/MapView';
import Results from './components/Results';
import RoundPrompt from './components/RoundPrompt';
import RoundResult from './components/RoundResult';
import StartScreen from './components/StartScreen';
import SoundToggle from './components/SoundToggle';
import StatusScreen from './components/StatusScreen';
import { fetchDaily, submitGuess, userMessage, warmGuess } from './lib/api';
import {
  bestTotal,
  entryFor,
  loadHistory,
  nextDate,
  previousDate,
  recordDay,
  streakEndingAt,
  type DayEntry,
  type GameHistory,
} from './lib/history';
import { useTapSound } from './hooks/useTapSound';
import { loadPracticeGame, scorePracticeGuess } from './lib/practice';
import { INITIAL_GAME_STATE, gameReducer, totalScoreOf } from './lib/round-state';
import { MIN_PING_MS, notBefore } from './lib/pacing';
import { MAX_ROUND_POINTS, type LatLng } from './lib/scoring';
import type { GameLocation } from './data/types';

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, INITIAL_GAME_STATE);
  // Lazy initialiser: this runs during the first render, so loadHistory is
  // written to never throw — the app has no error boundary and a corrupted
  // blob would otherwise be a white screen.
  const [history, setHistory] = useState<GameHistory>(() => loadHistory());
  const [isNewBest, setIsNewBest] = useState(false);
  const bestScore = useMemo(() => bestTotal(history), [history]);
  // Parallel to state.prompts: practice scores locally, so it needs the full
  // location (coordinates and all) that each prompt was made from. Daily
  // never populates this — its answers only exist on the server.
  const [practiceLocations, setPracticeLocations] = useState<GameLocation[]>([]);

  const totalScore = useMemo(() => totalScoreOf(state.outcomes), [state.outcomes]);
  // A restored day has no outcomes this session; a freshly played one has no
  // restoredRows. Exactly one of the two is populated whenever phase is
  // 'results'.
  const resultRows = state.restoredRows ?? state.outcomes;
  const maxScore = (state.prompts.length || resultRows.length) * MAX_ROUND_POINTS;
  const streak = state.gameDate ? streakEndingAt(history, state.gameDate) : 0;

  // The start screen has no server gameDate yet — nothing has been fetched —
  // so it anchors on the client's own Atlantic Standard Time calendar day.
  // 'en-CA' is the locale whose short date format is exactly YYYY-MM-DD, and
  // America/Puerto_Rico is UTC-4 all year, so this is the same string
  // /api/daily will call today.
  //
  // Anchoring instead on "the most recent date on record" would print a proud
  // 🔥 5 to somebody whose last five games ended a month ago; a streak that
  // survives not playing is not a streak. Today OR yesterday counts as live,
  // because today is not over and not having played it yet is not a break.
  const clientToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Puerto_Rico',
  }).format(new Date());
  const liveStreak = Math.max(
    streakEndingAt(history, clientToday),
    streakEndingAt(history, previousDate(clientToday)),
  );

  const currentPrompt = state.prompts[state.roundIndex];
  const lastOutcome = state.outcomes[state.outcomes.length - 1];
  const revealed = state.phase === 'revealed';

  // ---- fetch today's puzzle -------------------------------------------
  // Keyed on phase, so leaving 'load-error' back into 'loading' (the Retry
  // button) re-runs this effect. fetchDaily() memoises in-flight requests and
  // drops the memo on failure, which is what makes that retry a real retry
  // and what keeps React 19 StrictMode's double-invoked mount effect to one
  // network request in development.
  useEffect(() => {
    if (state.mode !== 'daily' || state.phase !== 'loading') return;
    let live = true;
    // Fired alongside the puzzle fetch rather than after it, on the theory
    // that the seconds the player spends reading the first prompt are budget
    // available to pay down the guess function's cold start before their
    // first tap — /api/daily and /api/guess are separate Vercel functions, so
    // fetching the puzzle warms neither the guess lambda nor its module graph.
    // Measuring this on the deployed preview did not prove a saving either
    // way: the warm-up request returns 400 without touching the database, so
    // its ~90ms isn't comparable to a real guess's ~228ms, and a true
    // cold-vs-cold comparison wasn't constructible (Vercel may already warm a
    // function during deployment). What the measurements did show is that the
    // guess lambda's own cold start looks small, and the real first-load cost
    // is Neon's compute waking — 1160ms cold vs 107ms warm — which
    // /api/daily already pays down on its own. So this call is cheap insurance
    // for an effect that may already be negligible, not a proven win. Never
    // awaited, never able to reject, and memoised to once per page load — so
    // it costs a returning player who already finished today one throwaway
    // 400 and nothing else.
    void warmGuess();
    void fetchDaily()
      .then((puzzle) => {
        if (!live) return;
        // Same-day reload: show the finished scoreboard instead of dealing the
        // same five prompts out again. The server would happily rescore them —
        // /api/guess is stateless — so this guard is the only thing that makes
        // "one puzzle a day" true.
        const played = entryFor(history, puzzle.gameDate);
        if (played) {
          dispatch({ type: 'daily/restore', gameDate: puzzle.gameDate, rows: played.rows });
          return;
        }
        dispatch({ type: 'daily/load-ok', puzzle });
      })
      .catch((error: unknown) => {
        if (live) dispatch({ type: 'daily/load-fail', message: userMessage(error) });
      });
    return () => {
      live = false;
    };
    // No loop: the effect body returns immediately unless phase === 'loading',
    // and history only changes on the transition into 'results'.
  }, [state.mode, state.phase, history]);

  // ---- build a practice game ------------------------------------------
  useEffect(() => {
    if (state.mode !== 'practice' || state.phase !== 'loading') return;
    let live = true;
    void loadPracticeGame()
      .then((game) => {
        if (!live) return;
        setPracticeLocations(game.locations);
        dispatch({ type: 'practice/ready', prompts: game.prompts });
      })
      .catch((error: unknown) => {
        if (live) {
          dispatch({
            type: 'daily/load-fail',
            message: `Could not start practice mode: ${String(error)}`,
          });
        }
      });
    return () => {
      live = false;
    };
  }, [state.mode, state.phase]);

  // ---- submit the pending guess ---------------------------------------
  // Driven by state rather than called straight from the click handler: the
  // reducer is the one thing that decides whether a tap counts, so firing the
  // request from the resulting 'submitting' phase means a rejected second tap
  // cannot smuggle out a second POST.
  useEffect(() => {
    if (state.phase !== 'submitting') return;
    const key = state.pendingKey;
    const guess = state.pendingGuess;
    if (!key || !guess) return;
    let live = true;

    // Both branches go through the same floor. Practice scores locally, but
    // that is not instant: evaluateGuess walks large municipio MultiPolygons
    // and measured 0.8-1.4s in a production build, close enough to a real
    // daily round trip that skipping the floor here isn't the win it looks
    // like — and without the floor, a faster practice round would flash the
    // ping for a frame while the daily mode showed a full cycle, two modes
    // that should feel identical feeling nothing alike.
    const resolve =
      state.mode === 'daily'
        ? notBefore(submitGuess(key, guess), MIN_PING_MS).then((result) => {
            if (live) dispatch({ type: 'guess/ok', key, result });
          })
        : notBefore(
            (async () => {
              const location = practiceLocations[state.roundIndex];
              if (!location) throw new Error('practice round has no location');
              return scorePracticeGuess(location, guess);
            })(),
            MIN_PING_MS,
          ).then((outcome) => {
            if (live) dispatch({ type: 'guess/resolved', key, outcome });
          });

    void resolve.catch((error: unknown) => {
      if (live) dispatch({ type: 'guess/fail', key, message: userMessage(error) });
    });

    return () => {
      live = false;
    };
  }, [state.phase, state.mode, state.roundIndex, state.pendingKey, state.pendingGuess, practiceLocations]);

  // ---- persist a finished daily puzzle ---------------------------------
  useEffect(() => {
    if (state.phase !== 'results' || state.mode !== 'daily') return;
    const gameDate = state.gameDate;
    if (!gameDate || state.outcomes.length === 0) return; // restored day: already stored
    // Decided out here, not inside the setHistory updater. Updaters must be
    // pure: React 19 StrictMode double-invokes them in development, so a
    // setIsNewBest() or a localStorage write in there fires twice, and React
    // is free to re-run them at any time for its own reasons.
    if (history.days[gameDate]) return;
    const previousBest = bestTotal(history);
    if (previousBest === null || totalScore > previousBest) setIsNewBest(true);

    const entry: DayEntry = {
      total: totalScore,
      // Structural subset of PlayedRound — the geometry and the tapped
      // points are dropped on purpose.
      rows: state.outcomes.map((outcome) => ({
        key: outcome.key,
        name: outcome.name,
        municipio: outcome.municipio,
        subtype: outcome.subtype,
        points: outcome.points,
        distanceKm: outcome.distanceKm,
        inside: outcome.inside,
      })),
      playedAt: new Date().toISOString(),
    };
    // The updater is now a pure "write it unless it is already there", which
    // is safe to run twice: recordDay is itself first-write-wins.
    setHistory((prev) => (prev.days[gameDate] ? prev : recordDay(prev, gameDate, entry)));
  }, [state.phase, state.mode, state.gameDate, state.outcomes, totalScore, history]);

  const startDaily = useCallback(() => {
    setIsNewBest(false);
    dispatch({ type: 'daily/load-start' });
  }, []);

  const startPractice = useCallback(() => {
    setIsNewBest(false);
    dispatch({ type: 'practice/load-start' });
  }, []);

  // Held at App level, not in MapView: the toggle renders outside the map and
  // has to read the same mute the tap handler writes.
  const { playTapSounds, muted, toggleMuted } = useTapSound();

  const handleGuess = useCallback(
    (guess: LatLng) => {
      // Fired here rather than inside MapView's click handler because this is
      // the one funnel both modes' taps pass through, and because the sounds
      // belong to a committed guess: MapView only calls onGuess when the map is
      // armed, so a tap during 'submitting' or a reveal stays silent.
      playTapSounds();
      dispatch({ type: 'guess/start', guess });
    },
    [playTapSounds],
  );

  const handleRetryGuess = useCallback(() => {
    dispatch({ type: 'guess/retry' });
  }, []);

  const handleNext = useCallback(() => {
    dispatch({ type: 'round/next' });
  }, []);

  const promptVisible =
    state.phase === 'playing' ||
    state.phase === 'submitting' ||
    state.phase === 'guess-error' ||
    state.phase === 'revealed';

  return (
    <div className="app">
      <MapView
        roundIndex={state.roundIndex}
        // Only 'playing' arms the map. 'submitting' must not, or the click
        // handler would fire a second request for a round already answered.
        interactive={state.phase === 'playing'}
        // A guess is in flight: MapView shows the ping.
        pending={state.phase === 'submitting'}
        revealed={revealed}
        // Non-null from the tap onward, not just at reveal. pendingGuess covers
        // 'submitting' and 'guess-error'; lastOutcome.guess takes over at
        // 'revealed', where the reducer has already nulled pendingGuess. Both
        // are the same coordinate, so the pin never moves.
        guess={state.pendingGuess ?? (revealed && lastOutcome ? lastOutcome.guess : null)}
        target={revealed && lastOutcome ? lastOutcome.answer : null}
        targetShape={revealed && lastOutcome ? lastOutcome.shape : null}
        targetRadiusKm={revealed && lastOutcome ? lastOutcome.acceptRadiusKm : null}
        inside={revealed && lastOutcome ? lastOutcome.inside : false}
        onGuess={handleGuess}
      />

      <SoundToggle muted={muted} onToggle={toggleMuted} />

      {promptVisible && currentPrompt && (
        <RoundPrompt
          prompt={currentPrompt}
          roundNumber={state.roundIndex + 1}
          totalRounds={state.prompts.length}
          totalScore={totalScore}
        />
      )}

      {state.phase === 'guess-error' && (
        <GuessError message={state.errorMessage ?? 'Try again.'} onRetry={handleRetryGuess} />
      )}

      {revealed && lastOutcome && (
        <RoundResult
          outcome={lastOutcome}
          isLastRound={state.roundIndex + 1 >= state.prompts.length}
          onNext={handleNext}
        />
      )}

      {state.phase === 'start' && (
        <StartScreen
          bestScore={bestScore}
          streak={liveStreak}
          onPlayDaily={startDaily}
          onPlayPractice={startPractice}
        />
      )}

      {state.phase === 'loading' && (
        <StatusScreen
          kicker="🇵🇷 Puerto Rico Edition"
          title="Cargando…"
          message={
            state.mode === 'daily' ? 'Fetching today’s five places.' : 'Shuffling five random places.'
          }
        />
      )}

      {state.phase === 'load-error' && (
        <StatusScreen
          kicker="🇵🇷 Puerto Rico Edition"
          title="Ay, bendito"
          message={state.errorMessage ?? 'Could not start the game.'}
          actionLabel="Try again"
          onAction={state.mode === 'daily' ? startDaily : startPractice}
        />
      )}

      {state.phase === 'results' && (
        <Results
          rows={resultRows}
          totalScore={state.restoredRows ? totalScoreOf(state.restoredRows) : totalScore}
          maxScore={maxScore}
          bestScore={bestScore}
          isNewBest={isNewBest}
          gameDate={state.mode === 'daily' ? state.gameDate : null}
          streak={state.mode === 'daily' ? streak : 0}
          nextPuzzleDate={state.mode === 'daily' && state.gameDate ? nextDate(state.gameDate) : null}
          // One daily puzzle per day: replaying it is not on offer.
          onPlayAgain={state.mode === 'practice' ? startPractice : null}
        />
      )}
    </div>
  );
}
