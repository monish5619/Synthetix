import type { ShipmentDetail } from '../../server/pipeline';
import { RISK_COPY, clock } from '../format';

interface Props {
  state: ShipmentDetail;
  /** Audit entry ids that arrived with the latest response. */
  fresh: Set<string>;
}

export function Activity({ state, fresh }: Props) {
  const { alerts, audit } = state;
  return (
    <section className="panel activity" aria-labelledby="activity-title">
      <div className="alerts-block">
        <p className="eyebrow">Retailer alerts</p>
        {alerts.length === 0 && <p className="quiet">No alerts sent. Alerts fire when risk escalates to high or critical.</p>}
        {alerts.map((a) => (
          <article key={a.id} className={`alert severity-${a.severity.toLowerCase()} ${fresh.has(a.id) ? 'is-new' : ''}`}>
            <div className="alert-head">
              <span className="alert-level">{RISK_COPY[a.severity].label}</span>
              <span className="alert-to">to {a.recipient}</span>
              <time className="muted" dateTime={a.createdAt}>
                {clock(a.createdAt)}
              </time>
            </div>
            <p>{a.message}</p>
          </article>
        ))}
      </div>

      <div className="audit-block">
        <header className="panel-head">
          <h2 id="activity-title">Audit trail</h2>
          <span className="panel-meta">newest first · from the database</span>
        </header>
        <ol className="audit-list">
          {audit.map((entry) => (
            <li key={entry.id} className={fresh.has(entry.id) ? 'is-new' : ''}>
              <time dateTime={entry.createdAt}>{clock(entry.createdAt)}</time>
              <div>
                <span className="event-type">{entry.eventType}</span>
                <p>{entry.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
