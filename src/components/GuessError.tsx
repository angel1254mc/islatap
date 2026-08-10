interface GuessErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Sits exactly where the round result normally appears. The tapped point is
 * still held in state, so retrying resubmits the same coordinates — the
 * player never has to reproduce a pixel because the network blinked.
 */
export default function GuessError({ message, onRetry }: GuessErrorProps) {
  return (
    <section className="result-panel result-panel--error" role="alert">
      <p className="result-panel__verdict">No pude enviar tu toque</p>
      <p className="result-panel__error-text">{message}</p>
      <button type="button" className="btn btn--primary" onClick={onRetry} autoFocus>
        Retry
      </button>
    </section>
  );
}
