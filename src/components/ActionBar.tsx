export type ActionKind = 'spike' | 'normal' | 'reset';

export type RunPhase = 'pending' | 'confirmed' | 'failed';

export interface RunStatus {
  kind: 'spike' | 'normal';
  phase: RunPhase;
  /** Backend-confirmed facts about this run. Empty until confirmed. */
  confirmations: string[];
  message?: string;
}

interface Props {
  busy: ActionKind | null;
  run: RunStatus | null;
  loadError: string | null;
  onSpike: () => void;
  onNormal: () => void;
  onReset: () => void;
  onRetry: () => void;
}

export function ActionBar({ busy, run, loadError, onSpike, onNormal, onReset, onRetry }: Props) {
  const locked = busy !== null;
  return (
    <section className="action" aria-labelledby="action-title">
      <div className="action-row">
        <div className="action-copy">
          <p className="eyebrow" id="action-title">
            Primary action · simulated telemetry, software only
          </p>
          <p>
            The server generates the reading, validates it, and runs the model, liquidation engine, and alerts. The
            screen only changes once the backend confirms.
          </p>
        </div>

        <div className="action-buttons">
          <button
            type="button"
            className="btn btn-primary"
            disabled={locked}
            aria-busy={busy === 'spike'}
            onClick={onSpike}
          >
            <span className="btn-glyph" aria-hidden="true">
              ◆
            </span>
            {busy === 'spike' ? 'Simulating…' : 'Simulate ambient temperature spike'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={locked} onClick={onNormal}>
            {busy === 'normal' ? 'Recording…' : 'Normal reading'}
          </button>
          <button type="button" className="btn btn-tertiary" disabled={locked} onClick={onReset}>
            {busy === 'reset' ? 'Resetting…' : 'Reset demo'}
          </button>
        </div>
      </div>

      {loadError && (
        <p className="notice is-error" role="alert">
          {loadError}
        </p>
      )}

      {run?.phase === 'pending' && (
        <div className="run is-pending" role="status" aria-live="polite">
          <span className="run-spinner" aria-hidden="true" />
          <span>Sending the reading to the server. Nothing on screen changes until it is confirmed.</span>
        </div>
      )}

      {run?.phase === 'confirmed' && (
        <div className="run is-confirmed" role="status" aria-live="polite">
          <p className="run-title">Confirmed by the backend</p>
          <ul className="confirms">
            {run.confirmations.map((label) => (
              <li key={label}>
                <span className="check" aria-hidden="true">
                  ✓
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run?.phase === 'failed' && (
        <div className="run is-failed" role="alert">
          <p className="run-title">Not confirmed</p>
          <p>
            The backend did not confirm this {run.kind === 'spike' ? 'event' : 'reading'}.{' '}
            {run.message ? `${run.message} ` : ''}Nothing was changed.
          </p>
          <button type="button" className="btn btn-secondary" disabled={locked} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
