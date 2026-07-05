import type { RoundOutcome } from '../lib/game';
import { formatDistance } from '../lib/scoring';

function verdictFor(points: number): string {
  if (points >= 4800) return '¡Wepa! Clavao’ 🎯';
  if (points >= 4000) return '¡Brutal! Bien cerquita.';
  if (points >= 2500) return 'Nada mal, nada mal…';
  if (points >= 1000) return 'Casi casi. ¡Sigue!';
  return 'Pa’ la próxima… 🧭';
}

interface RoundResultProps {
  outcome: RoundOutcome;
  isLastRound: boolean;
  onNext: () => void;
}

export default function RoundResult({ outcome, isLastRound, onNext }: RoundResultProps) {
  return (
    <section className="result-panel" aria-live="polite">
      <p className="result-panel__verdict">{verdictFor(outcome.points)}</p>
      <div className="result-panel__stats">
        <div className="stat">
          <span className="stat__label">Distance</span>
          <strong className="stat__value">{formatDistance(outcome.distanceKm)}</strong>
        </div>
        <div className="stat stat--points">
          <span className="stat__label">Points</span>
          <strong className="stat__value">+{outcome.points.toLocaleString('en-US')}</strong>
        </div>
      </div>
      <button type="button" className="btn btn--primary" onClick={onNext} autoFocus>
        {isLastRound ? 'See results' : 'Next'}
      </button>
    </section>
  );
}
