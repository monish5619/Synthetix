import type { DemoPhase, StepView } from '../demo/useJudgeDemo';

interface Props {
  steps: StepView[];
  phase: DemoPhase;
  error: string | null;
  elapsedMs: number;
  /** True while anything else on the page is writing. */
  disabled: boolean;
  onRun: () => void;
}

export const clockText = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The guided story. Every headline in it was copied from a server response. */
export function JudgeDemo({ steps, phase, error, elapsedMs, disabled, onRun }: Props) {
  const running = phase === 'running';
  return (
    <section className={`jd is-${phase}`} aria-labelledby="jd-title">
      <header className="jd-head">
        <div>
          <h2 id="jd-title" className="jd-title">
            {phase === 'success' ? 'Spoilage prevented — from 120 h to rescue' : 'See the whole story in one click'}
          </h2>
          <p className="jd-sub">Spoilage risk → automatic markdown → marketplace deal → retailer rescue. Every step runs on the real backend.</p>
        </div>
        <div className="jd-run">
          {phase !== 'idle' && (
            <span className="jd-timer" role="timer" aria-label="Elapsed time">
              {clockText(elapsedMs)}
            </span>
          )}
          <button type="button" className="btn btn-primary jd-btn" disabled={disabled || running} aria-busy={running} onClick={onRun}>
            {running ? 'Running…' : phase === 'idle' ? 'RUN 3-MIN JUDGE DEMO' : 'RUN AGAIN'}
          </button>
        </div>
      </header>

      <ol className="jd-steps" aria-label="Demo steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`jd-step is-${s.status}`} aria-current={s.status === 'active' ? 'step' : undefined}>
            <span className="jd-mark" aria-hidden="true">
              {s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : i + 1}
            </span>
            <div className="jd-body">
              <p className="jd-step-title">{s.title}</p>
              {s.headline && <p className="jd-headline">{s.headline}</p>}
              {s.facts.length > 0 && (
                <ul className="jd-facts">
                  {s.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>

      {phase === 'failed' && error && (
        <p className="notice is-error" role="alert">
          The demo stopped: {error} Nothing is faked. Fix the cause and run it again.
        </p>
      )}
      {phase === 'success' && (
        <p className="jd-done" role="status">
          Finished in {clockText(elapsedMs)}. The state is stored on the server — see it on the{' '}
          <a href="#/marketplace">Marketplace</a>, <a href="#/alerts">Alerts</a> and <a href="#/telemetry">Telemetry</a> pages.
        </p>
      )}
    </section>
  );
}
