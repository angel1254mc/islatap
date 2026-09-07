interface SoundToggleProps {
  muted: boolean;
  onToggle: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  /** Play a sample at the new level. Fired on release, not on every step. */
  onPreview: () => void;
}

export default function SoundToggle({
  muted,
  onToggle,
  volume,
  onVolumeChange,
  onPreview,
}: SoundToggleProps) {
  return (
    <div className="sound-control">
      <button
        type="button"
        className="sound-control__button"
        onClick={onToggle}
        aria-pressed={muted}
        aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
        title={muted ? 'Turn sound on' : 'Turn sound off'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          {/* Speaker cone and body */}
          <path
            d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {muted ? (
            /* Cross: sound is off */
            <path
              d="M16 9.5l5 5m0-5l-5 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          ) : (
            /* Two arcs: sound is on */
            <path
              d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </svg>
      </button>

      <input
        type="range"
        className="sound-control__slider"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        disabled={muted}
        aria-label="Volume"
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        onPointerUp={onPreview}
        onKeyUp={onPreview}
      />
    </div>
  );
}
