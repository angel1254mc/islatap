interface StatusScreenProps {
  kicker: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Full-bleed overlay for the two states the game never had before: waiting for
 * today's puzzle, and failing to get it. Reuses the start/results screen
 * chrome so it sits over the always-mounted map exactly like they do.
 */
export default function StatusScreen({
  kicker,
  title,
  message,
  actionLabel,
  onAction,
}: StatusScreenProps) {
  return (
    <div className="screen">
      <div className="screen__card">
        <p className="screen__kicker">{kicker}</p>
        <h1 className="screen__title">{title}</h1>
        <p className="screen__lede" aria-live="polite">
          {message}
        </p>
        {actionLabel && onAction && (
          <div>
            <button type="button" className="btn btn--primary btn--big" onClick={onAction}>
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
