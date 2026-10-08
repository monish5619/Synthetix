import type { HealthReport } from '../api';
import { ROUTE_HREF, ROUTES, type Route } from '../route';

const NAV_LABEL: Record<Route, string> = {
  control: 'Control Tower',
  marketplace: 'Marketplace',
  telemetry: 'Telemetry',
  alerts: 'Alerts',
};

export function Masthead({ route }: { route: Route }) {
  return (
    <header className="masthead">
      <div className="brand">
        <span className="wordmark">AGROSENSE</span>
        <span className="tagline">Predictive cold-chain intelligence</span>
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

interface FooterProps {
  health: HealthReport | null;
  healthError: boolean;
}

/** System status is shown quietly at the foot of the page. It is not a dashboard panel. */
export function SystemFooter({ health, healthError }: FooterProps) {
  const items: Array<[string, string, boolean | null]> = health
    ? [
        ['Telemetry API', health.telemetryApi, true],
        ['Degradation engine', health.degradationEngine, health.degradationEngine === 'READY'],
        ['Liquidation engine', health.liquidationEngine, health.liquidationEngine === 'READY'],
        ['Database', health.database, true],
      ]
    : [
        ['System', healthError ? 'unreachable' : 'checking', null],
      ];
  return (
    <footer className="system-footer">
      <ul className="system-list" aria-label="System status">
        {items.map(([label, status, ok]) => (
          <li key={label} className={ok === null ? 'is-pending' : ok ? 'is-ok' : 'is-bad'}>
            <span className="system-dot" aria-hidden="true" />
            {label} <span className="system-status">{status}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
