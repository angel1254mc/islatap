import { useCallback, useMemo, useState } from 'react';
import MapView from './components/MapView';
import Results from './components/Results';
import RoundPrompt from './components/RoundPrompt';
import RoundResult from './components/RoundResult';
import StartScreen from './components/StartScreen';
import type { GameLocation } from './data/locations';
import { loadBestScore, pickGameRounds, saveBestScore, type RoundOutcome } from './lib/game';
import { haversineKm, scoreForDistance, type LatLng } from './lib/scoring';

type Phase = 'start' | 'playing' | 'revealed' | 'results';

export default function App() {
  const [phase, setPhase] = useState<Phase>('start');
  const [rounds, setRounds] = useState<GameLocation[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<RoundOutcome[]>([]);
  const [bestScore, setBestScore] = useState<number | null>(() => loadBestScore());
  const [isNewBest, setIsNewBest] = useState(false);

  const totalScore = useMemo(
    () => outcomes.reduce((sum, outcome) => sum + outcome.points, 0),
    [outcomes],
  );

  const currentLocation: GameLocation | undefined = rounds[roundIndex];
  const lastOutcome: RoundOutcome | undefined = outcomes[outcomes.length - 1];
  const revealed = phase === 'revealed';

  const startGame = useCallback(() => {
    setRounds(pickGameRounds());
    setRoundIndex(0);
    setOutcomes([]);
    setIsNewBest(false);
    setPhase('playing');
  }, []);

  const handleGuess = useCallback(
    (guess: LatLng) => {
      if (phase !== 'playing' || !currentLocation) return;
      const distanceKm = haversineKm(guess, currentLocation);
      const points = scoreForDistance(distanceKm);
      setOutcomes((previous) => [...previous, { location: currentLocation, guess, distanceKm, points }]);
      setPhase('revealed');
    },
    [phase, currentLocation],
  );

  const handleNext = useCallback(() => {
    if (phase !== 'revealed') return;
    if (roundIndex + 1 >= rounds.length) {
      if (bestScore === null || totalScore > bestScore) {
        setBestScore(totalScore);
        setIsNewBest(true);
        saveBestScore(totalScore);
      }
      setPhase('results');
    } else {
      setRoundIndex((index) => index + 1);
      setPhase('playing');
    }
  }, [phase, roundIndex, rounds.length, bestScore, totalScore]);

  return (
    <div className="app">
      <MapView
        roundIndex={roundIndex}
        interactive={phase === 'playing'}
        revealed={revealed}
        guess={revealed && lastOutcome ? lastOutcome.guess : null}
        target={revealed && currentLocation ? currentLocation : null}
        onGuess={handleGuess}
      />

      {(phase === 'playing' || phase === 'revealed') && currentLocation && (
        <RoundPrompt
          location={currentLocation}
          roundNumber={roundIndex + 1}
          totalRounds={rounds.length}
          totalScore={totalScore}
        />
      )}

      {revealed && lastOutcome && (
        <RoundResult
          outcome={lastOutcome}
          isLastRound={roundIndex + 1 >= rounds.length}
          onNext={handleNext}
        />
      )}

      {phase === 'start' && <StartScreen bestScore={bestScore} onPlay={startGame} />}

      {phase === 'results' && (
        <Results
          outcomes={outcomes}
          totalScore={totalScore}
          bestScore={bestScore}
          isNewBest={isNewBest}
          onPlayAgain={startGame}
        />
      )}
    </div>
  );
}
