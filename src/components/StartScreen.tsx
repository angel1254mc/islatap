interface StartScreenProps {
  bestScore: number | null;
  onPlay: () => void;
}

export default function StartScreen({ bestScore, onPlay }: StartScreenProps) {
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
          <li>🏆 25,000 is a perfect game. ¿Te atreves?</li>
        </ul>
        {bestScore !== null && (
          <div className="best-chip">
            Best score <strong>{bestScore.toLocaleString('en-US')}</strong>
          </div>
        )}
        <div>
          <button type="button" className="btn btn--primary btn--big" onClick={onPlay}>
            Play
          </button>
        </div>
      </div>
    </div>
  );
}
