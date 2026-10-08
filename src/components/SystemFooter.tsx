import type { HealthReport } from '../api';
import { healthDots } from '../shell/status';
import { StatusDot } from '../ui/StatusDot';

interface Props {
  health: HealthReport | null;
  healthError: boolean;
}

/** System status as four compact dots. The exact meaning of each is in its tooltip. */
export function SystemFooter({ health, healthError }: Props) {
  return (
    <footer className="system-footer">
      {health ? (
        <ul className="system-list" aria-label="System status">
          {healthDots(health).map((d) => (
            <li key={d.key}>
              <StatusDot state={d.state} meaning={d.meaning} />
              <span className="system-status">{d.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="system-list" aria-label="System status">
          <li>
            <StatusDot
              state={healthError ? 'failure' : 'warning'}
              meaning={healthError ? 'The AgroSense server could not be reached.' : 'Checking the server.'}
            />
            <span className="system-status">{healthError ? 'Server unreachable' : 'Checking'}</span>
          </li>
        </ul>
      )}
    </footer>
  );
}
