import { fetchAlerts, type AlertItem } from '../api';
import { RISK_COPY, clock, hours, rupees } from '../format';
import { usePoll } from '../poll';

/** Alerts are read from the database. The UI does not create or reword them. */
export function AlertsPage() {
  const { data, error, loading, syncedAt } = usePoll(fetchAlerts, 4000);

  return (
    <section className="page" aria-labelledby="al-title">
      <header className="page-head">
        <div>
          <p className="eyebrow">Spoilage alerts</p>
          <h1 id="al-title">Alerts</h1>
        </div>
        <span className="panel-meta">
          {syncedAt ? `Synced ${clock(syncedAt.toISOString())} · refreshes every 4 s` : 'Loading…'}
        </span>
      </header>

      {error && (
        <p className="notice is-error" role="alert">
          {data ? `Showing the last synced alerts. ${error}` : error}
        </p>
      )}
      {loading && !data && <p className="quiet" role="status">Loading alerts from the database…</p>}

      {data && data.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No spoilage alerts</p>
          <p>An alert is written when risk escalates to high or critical. Run the spike on the Control Tower to see one.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="alert-list">
          {data.map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AlertCard({ alert: a }: { alert: AlertItem }) {
  const critical = a.severity === 'CRITICAL';
  return (
    <li className={`alert-card ${critical ? 'is-critical' : 'is-high'}`}>
      <div className="alert-card-head">
        <span className="alert-kicker">{critical ? 'Critical spoilage alert' : 'High spoilage alert'}</span>
        <time dateTime={a.createdAt}>{clock(a.createdAt)}</time>
      </div>
      <h2 className="alert-title">Shipment {a.code}</h2>
      <p className="alert-meta">
        {a.produce} · <strong>{hours(a.remainingHours)} hours remaining</strong> · {RISK_COPY[a.severity].label}
      </p>

      <dl className="alert-facts">
        <div>
          <dt>Recommended action</dt>
          <dd>{a.recommendedAction}</dd>
        </div>
        {a.markdownPct !== null && (
          <div>
            <dt>Markdown</dt>
            <dd>
              {a.markdownPct}%
              {a.recommendedPricePerKg !== null && <span className="cell-sub"> · {rupees(a.recommendedPricePerKg)}/kg</span>}
            </dd>
          </div>
        )}
        <div>
          <dt>Recipient</dt>
          <dd>{a.recipient}</dd>
        </div>
      </dl>
      <p className="alert-message">{a.message}</p>
    </li>
  );
}
