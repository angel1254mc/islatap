import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import GuessError from './components/GuessError';
import MapView from './components/MapView';
import Results from './components/Results';
import RoundPrompt from './components/RoundPrompt';
import RoundResult from './components/RoundResult';
import StartScreen from './components/StartScreen';
import StatusScreen from './components/StatusScreen';
import { fetchDaily, submitGuess, userMessage } from './lib/api';
import { loadBestScore, saveBestScore } from './lib/game';
import { INITIAL_GAME_STATE, gameReducer, totalScoreOf } from './lib/round-state';
import { MAX_ROUND_POINTS, type LatLng } from './lib/scoring';
import { startShapeLoad } from './lib/shapes';

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, INITIAL_GAME_STATE);
  const [bestScore, setBestScore] = useState<number | null>(() => loadBestScore());
  const [isNewBest, setIsNewBest] = useState(false);

  // Boundary shapes still load at mount here; a later task moves this off the
  // critical path now that the daily reveal gets its geometry from the guess
  // response instead of from this file.
  useEffect(() => {
    void startShapeLoad();
  }, []);

  const totalScore = useMemo(() => totalScoreOf(state.outcomes), [state.outcomes]);
  const maxScore = state.prompts.length * MAX_ROUND_POINTS;
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
    if (state.phase !== 'loading') return;
    let live = true;
    void fetchDaily()
      .then((puzzle) => {
        if (live) dispatch({ type: 'daily/load-ok', puzzle });
      })
      .catch((error: unknown) => {
        if (live) dispatch({ type: 'daily/load-fail', message: userMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [state.phase]);

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
    void submitGuess(key, guess)
      .then((result) => {
        if (live) dispatch({ type: 'guess/ok', key, result });
      })
      .catch((error: unknown) => {
        if (live) dispatch({ type: 'guess/fail', key, message: userMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [state.phase, state.pendingKey, state.pendingGuess]);

  // ---- best score -------------------------------------------------------
  useEffect(() => {
    if (state.phase !== 'results') return;
    if (bestScore === null || totalScore > bestScore) {
      setBestScore(totalScore);
      setIsNewBest(true);
      saveBestScore(totalScore);
    }
  }, [state.phase, totalScore, bestScore]);

  const startDaily = useCallback(() => {
    setIsNewBest(false);
    dispatch({ type: 'daily/load-start' });
  }, []);

  const handleGuess = useCallback((guess: LatLng) => {
    dispatch({ type: 'guess/start', guess });
  }, []);

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
        revealed={revealed}
        guess={revealed && lastOutcome ? lastOutcome.guess : null}
        target={revealed && lastOutcome ? lastOutcome.answer : null}
        targetShape={revealed && lastOutcome ? lastOutcome.shape : null}
        targetRadiusKm={revealed && lastOutcome ? lastOutcome.acceptRadiusKm : null}
        inside={revealed && lastOutcome ? lastOutcome.inside : false}
        onGuess={handleGuess}
      />

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

      {state.phase === 'start' && <StartScreen bestScore={bestScore} onPlay={startDaily} />}

      {state.phase === 'loading' && (
        <StatusScreen
          kicker="🇵🇷 Puerto Rico Edition"
          title="Cargando…"
          message="Fetching today’s five places."
        />
      )}

      {state.phase === 'load-error' && (
        <StatusScreen
          kicker="🇵🇷 Puerto Rico Edition"
          title="Ay, bendito"
          message={state.errorMessage ?? 'Could not load today’s puzzle.'}
          actionLabel="Try again"
          onAction={startDaily}
        />
      )}

      {state.phase === 'results' && (
        <Results
          rows={state.outcomes}
          totalScore={totalScore}
          maxScore={maxScore}
          bestScore={bestScore}
          isNewBest={isNewBest}
          onPlayAgain={startDaily}
        />
      )}
    </div>
  );
}
