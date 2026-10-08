import { useState } from 'react';
import { acknowledgeAlert, fetchAlerts, type AlertItem } from '../api';
import { RISK_COPY, clock, hours, rupees } from '../format';
import { usePoll } from '../poll';

/** Alerts are read from the database. Acknowledging one writes back to the database, and the page shows what was stored. */
export function AlertsPage() {
  const { data, error, loading, syncedAt, reload } = usePoll(fetchAlerts, 4000);
  const [acking, setAcking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function acknowledge(id: string) {
    setAcking(id);
    setActionError(null);
    try {
      await acknowledgeAlert(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The alert could not be acknowledged. Nothing changed.');
    } finally {
      setAcking(null);
    }
  }

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
      {actionError && (
        <p className="notice is-error" role="alert">
          {actionError}
        </p>
      )}
      {loading && !data && <p className="quiet" role="status">Loading alerts from the database…</p>}

      {data && data.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No spoilage alerts</p>
          <p>An alert is recorded when risk escalates to high or critical. Run the spike on the Control Tower to see one.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="alert-list">
          {data.map((a) => (
            <AlertCard key={a.id} alert={a} busy={acking === a.id} onAcknowledge={() => acknowledge(a.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AlertCard({ alert: a, busy, onAcknowledge }: { alert: AlertItem; busy: boolean; onAcknowledge: () => void }) {
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

      <div className="alert-ack">
        {a.acknowledgedAt ? (
          <p className="ack-done">
            <span className="check" aria-hidden="true">
              ✓
            </span>
            Acknowledged by the retailer at {clock(a.acknowledgedAt)}
          </p>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onAcknowledge}>
            {busy ? 'Recording…' : 'Acknowledge offer'}
          </button>
        )}
      </div>
    </li>
  );
}
