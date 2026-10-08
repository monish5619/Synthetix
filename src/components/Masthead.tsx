import type { HealthReport } from '../api';
import { ROUTE_HREF, ROUTES, type Route } from '../route';

interface Props {
  health: HealthReport | null;
  healthError: boolean;
  route: Route;
}

type Tone = 'ok' | 'bad' | 'pending';

interface Check {
  label: string;
  status: string;
  tone: Tone;
}

const NAV_LABEL: Record<Route, string> = {
  control: 'Control Tower',
  marketplace: 'Marketplace',
  telemetry: 'Telemetry',
  alerts: 'Alerts',
};

/** Health statuses come from the last /api/health response. Without one, they read as unknown. */
function checksFrom(health: HealthReport | null, failed: boolean): Check[] {
  if (!health) {
    return [
      { label: 'Telemetry API', status: failed ? 'OFFLINE' : 'CHECKING', tone: failed ? 'bad' : 'pending' },
      { label: 'Degradation engine', status: failed ? 'UNKNOWN' : 'CHECKING', tone: failed ? 'bad' : 'pending' },
      { label: 'Liquidation engine', status: failed ? 'UNKNOWN' : 'CHECKING', tone: failed ? 'bad' : 'pending' },
      { label: 'Database', status: failed ? 'UNKNOWN' : 'CHECKING', tone: failed ? 'bad' : 'pending' },
    ];
  }
  const ready = (s: string): Tone => (s === 'READY' ? 'ok' : 'bad');
  return [
    { label: 'Telemetry API', status: health.telemetryApi, tone: 'ok' },
    { label: 'Degradation engine', status: health.degradationEngine, tone: ready(health.degradationEngine) },
    { label: 'Liquidation engine', status: health.liquidationEngine, tone: ready(health.liquidationEngine) },
    { label: 'Database', status: health.database, tone: 'ok' },
  ];
}

export function Masthead({ health, healthError, route }: Props) {
  const checks = checksFrom(health, healthError);
  return (
    <header className="masthead">
      <div className="masthead-top">
        <div className="brand">
          <span className="wordmark">AGROSENSE</span>
          <span className="tagline">Predictive Cold-Chain Intelligence</span>
        </div>
        <ul className="health" aria-label="System health">
          {checks.map((c) => (
            <li key={c.label} className={`health-item tone-${c.tone}`}>
              <span className="health-dot" aria-hidden="true" />
              <span className="health-label">{c.label}</span>
              <span className="health-status">{c.status}</span>
            </li>
          ))}
        </ul>
      </div>
      <nav className="nav" aria-label="Primary">
        {ROUTES.map((r) => (
          <a
            key={r}
            href={ROUTE_HREF[r]}
            className={`nav-link ${route === r ? 'is-active' : ''}`}
            aria-current={route === r ? 'page' : undefined}
          >
            {NAV_LABEL[r]}
          </a>
        ))}
      </nav>
    </header>
  );
}
