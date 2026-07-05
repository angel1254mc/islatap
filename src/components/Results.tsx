import { useEffect, useRef, useState } from 'react';
import { MAX_GAME_POINTS, buildShareText, type RoundOutcome } from '../lib/game';
import { formatDistance } from '../lib/scoring';

interface ResultsProps {
  outcomes: RoundOutcome[];
  totalScore: number;
  bestScore: number | null;
  isNewBest: boolean;
  onPlayAgain: () => void;
}

export default function Results({
  outcomes,
  totalScore,
  bestScore,
  isNewBest,
  onPlayAgain,
}: ResultsProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimer.current);
  }, []);

  const copyResult = async () => {
    const text = buildShareText(outcomes, totalScore);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="screen">
      <div className="screen__card screen__card--wide">
        <p className="screen__kicker">Final score</p>
        <h1 className="results__total">
          {totalScore.toLocaleString('en-US')}
          <small> / {MAX_GAME_POINTS.toLocaleString('en-US')}</small>
        </h1>
        {isNewBest ? (
          <p className="results__best results__best--new">🏆 ¡Nuevo récord! New best score.</p>
        ) : (
          <p className="results__best">
            Best score: {bestScore !== null ? bestScore.toLocaleString('en-US') : '—'}
          </p>
        )}

        <div className="results__table-wrap">
          <table className="results__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Place</th>
                <th>Distance</th>
                <th className="results__points-col">Points</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome, index) => (
                <tr key={outcome.location.id}>
                  <td>{index + 1}</td>
                  <td className="results__place">
                    {outcome.location.name}
                    <small>{outcome.location.category}</small>
                  </td>
                  <td>{formatDistance(outcome.distanceKm)}</td>
                  <td className="results__points-col">
                    {outcome.points.toLocaleString('en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="results__actions">
          <button type="button" className="btn btn--ghost" onClick={() => void copyResult()}>
            {copied ? 'Copied ✓' : 'Copy result'}
          </button>
          <button type="button" className="btn btn--primary" onClick={onPlayAgain}>
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}
