interface StartScreenProps {
  bestScore: number | null;
  onPlayDaily: () => void;
  onPlayPractice: () => void;
}

export default function StartScreen({ bestScore, onPlayDaily, onPlayPractice }: StartScreenProps) {
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
        {bestScore !== null && (
          <div className="best-chip">
            Best score <strong>{bestScore.toLocaleString('en-US')}</strong>
          </div>
        )}
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
