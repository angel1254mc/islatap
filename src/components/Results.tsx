import { useEffect, useRef, useState } from 'react';
import type { ResultRow } from '../lib/round-state';
import { buildShareText } from '../lib/share';
import { formatDistance } from '../lib/scoring';
// From data/types, NOT data/locations. Results.tsx is statically imported by
// App.tsx, and data/locations re-exports displayName alongside the 216 KB
// LOCATIONS array — Rollup keeps a module that the entry imports statically in
// the entry chunk even when a lazy chunk also imports it dynamically, so one
// character of import path here is the difference between a code split that
// works and one that silently does not. data/types has no LOCATIONS.
import { displayName } from '../data/types';

interface ResultsProps {
  rows: ResultRow[];
  totalScore: number;
  /** Perfect score for THIS puzzle — the server owns the round count now. */
  maxScore: number;
  bestScore: number | null;
  isNewBest: boolean;
  /** 'YYYY-MM-DD' for a daily puzzle; null for practice. */
  gameDate: string | null;
  streak: number;
  /** 'YYYY-MM-DD' of the next puzzle; null for practice. */
  nextPuzzleDate: string | null;
  /** Null when replaying is not offered (the daily puzzle is once a day). */
  onPlayAgain: (() => void) | null;
}

export default function Results({
  rows,
  totalScore,
  maxScore,
  bestScore,
  isNewBest,
  gameDate,
  streak,
  nextPuzzleDate,
  onPlayAgain,
}: ResultsProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimer.current);
  }, []);

  const copyResult = async () => {
    const text = buildShareText(rows, {
      total: totalScore,
      maxTotal: maxScore,
      gameDate,
      streak,
    });
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
          <small> / {maxScore.toLocaleString('en-US')}</small>
        </h1>
        {isNewBest ? (
          <p className="results__best results__best--new">🏆 ¡Nuevo récord! New best score.</p>
        ) : (
          <p className="results__best">
            Best score: {bestScore !== null ? bestScore.toLocaleString('en-US') : '—'}
          </p>
        )}
        {streak > 1 && <p className="results__streak">🔥 {streak} days in a row</p>}

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
              {rows.map((row, index) => (
                <tr key={row.key}>
                  <td>{index + 1}</td>
                  <td className="results__place">
                    {displayName(row)}
                    {row.subtype && <small>{row.subtype}</small>}
                  </td>
                  <td>{row.inside ? '¡Adentro!' : formatDistance(row.distanceKm)}</td>
                  <td className="results__points-col">{row.points.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="results__actions">
          <button type="button" className="btn btn--ghost" onClick={() => void copyResult()}>
            {copied ? 'Copied ✓' : 'Copy result'}
          </button>
          {onPlayAgain ? (
            <button type="button" className="btn btn--primary" onClick={onPlayAgain}>
              Play again
            </button>
          ) : (
            nextPuzzleDate && (
              <p className="results__tomorrow">
                Vuelve mañana — the next puzzle drops <strong>{nextPuzzleDate}</strong>.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}
