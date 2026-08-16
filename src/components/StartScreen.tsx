interface StartScreenProps {
  bestScore: number | null;
  /**
   * Consecutive days played, ending today or yesterday. Zero once the streak
   * is broken — App anchors this on the client's AST calendar day rather than
   * on the last date on record, so it cannot brag about a dead streak.
   */
  streak: number;
  onPlayDaily: () => void;
  onPlayPractice: () => void;
}

export default function StartScreen({
  bestScore,
  streak,
  onPlayDaily,
  onPlayPractice,
}: StartScreenProps) {
  return (
    <div className="screen">
      <div className="screen__card">
        <p className="screen__kicker">🇵🇷 Puerto Rico Edition</p>
        <h1 className="screen__title">
          Isla<span>Tap</span>
        </h1>
        <p className="screen__lede">
          Five places. One tap each. How well do you really know la Isla del Encanto?
        </p>
        <ul className="screen__rules">
          <li>📍 Read the prompt, then tap the satellite map as close as you can.</li>
          <li>📏 The closer your tap, the more you earn — up to 5,000 points a round.</li>
          <li>🗓️ Everyone gets the same five places each day. Practice is unlimited.</li>
        </ul>
        <div className="chip-row">
          {streak > 1 && (
            <div className="best-chip">
              Streak <strong>🔥 {streak}</strong>
            </div>
          )}
          {bestScore !== null && (
            <div className="best-chip">
              Best score <strong>{bestScore.toLocaleString('en-US')}</strong>
            </div>
          )}
        </div>
        <div className="start__actions">
          <button type="button" className="btn btn--primary btn--big" onClick={onPlayDaily}>
            Today’s puzzle
          </button>
          <button type="button" className="btn btn--ghost" onClick={onPlayPractice}>
            Practice
          </button>
        </div>
      </div>
    </div>
  );
}
