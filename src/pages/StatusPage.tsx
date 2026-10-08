import type { HealthReport } from '../api';
import { clock } from '../format';
import { useStreamState } from '../live';
import { statusTiles, type StreamState } from '../shell/tiles';
import { ErrorState, PageHeader, Skeleton } from '../ui/layout';

interface Props {
  health: HealthReport | null;
  failed: boolean;
  /** Tests pass the stream state in; the page otherwise reads the real connection. */
  stream?: StreamState;
}

const WORD = { healthy: 'Healthy', failing: 'Failing', checking: 'Checking' } as const;
const MARK = { healthy: '●', failing: '■', checking: '◆' } as const;

/** The server's own health report as five tiles. Green = healthy, red = failing. Nothing is inferred. */
export function StatusPage({ health, failed, stream }: Props) {
  const live = useStreamState();
  const tiles = statusTiles(health, stream ?? live);

  return (
    <section className="page" aria-labelledby="page-title">
      <PageHeader title="Status" subtitle={health ? `Checked ${clock(health.checkedAt)}` : undefined} />

      {!health && failed && <ErrorState title="Server unreachable" message="Could not reach the AgroSense server." />}
      {!health && !failed && <Skeleton height={120} />}

      {(health || failed) && (
        <ul className="tiles" aria-label="System status">
          {tiles.map((t) => {
            const state = !health && failed && t.key !== 'realtime' ? 'failing' : t.state;
            return (
              <li key={t.key} className={`tile is-${state}`}>
                <span className="tile-mark" aria-hidden="true">
                  {MARK[state]}
                </span>
                <div>
                  <p className="tile-name">{t.label}</p>
                  <p className="tile-state">{WORD[state]}</p>
                  <p className="tile-detail">{state === 'failing' && !health ? 'Server unreachable' : t.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
