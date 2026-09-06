interface SoundToggleProps {
  muted: boolean;
  onToggle: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  /** Play a sample at the new level. Fired on release, not on every step. */
  onPreview: () => void;
}

/**
 * Sits above the zoom control at bottom-left, grouped with the other map
 * controls rather than in the HUD — the HUD's right slot is the score chip, and
 * its left slot is the round counter.
 *
 * The speaker's label says what the button will do, not what the current state
 * is, which is what a screen reader user needs from a control; aria-pressed
 * carries the state itself.
 */
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
          <path
            d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {muted ? (
            <path
              d="M16 9.5l5 5m0-5l-5 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          ) : (
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

      {/*
        Disabled rather than hidden while muted: a slider that moves but changes
        nothing is the more confusing of the two, and leaving it in place keeps
        the control from resizing the moment you mute.

        The preview fires on release — pointerup and keyup — rather than in
        onChange, which browsers fire on every step of a drag and would stack a
        dozen overlapping dings.
      */}
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
