import { useState } from 'react';
import { acknowledgeAlert, fetchAlerts, type AlertItem } from '../api';
import { alertHeadline, unreadCount } from '../alerts';
import { RiskBadge } from '../components/RiskBadge';
import { clock, hours, rupees } from '../format';
import { useChangeStream } from '../live';
import { usePoll } from '../poll';
import { InfoTip } from '../ui/InfoTip';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../ui/layout';

/** Alerts are read from the database. Acknowledging one writes back, and the page shows what was stored. */
export function AlertsPage() {
  const { data, error, loading, reload } = usePoll(fetchAlerts, 4000);
  useChangeStream(() => reload());
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
    <section className="page" aria-labelledby="page-title">
      <PageHeader title="Alerts" subtitle={data ? `${unreadCount(data)} unread · ${data.length} total` : undefined} />

      {error && !data && <ErrorState title="We can't load alerts" message={`${error} Check that the server is running, then try again.`} onRetry={reload} />}
      {error && data && (
        <p className="notice is-error" role="alert">
          Showing the last synced alerts. {error}
        </p>
      )}
      {actionError && (
        <p className="notice is-error" role="alert">
          {actionError}
        </p>
      )}
      {loading && !data && <Skeleton height={96} />}
      {data && data.length === 0 && <EmptyState icon="bell" title="No spoilage alerts" hint="An alert is recorded when risk reaches high or critical." />}

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
  return (
    <li className={`alert-card ${a.severity === 'CRITICAL' ? 'is-critical' : 'is-high'} ${a.acknowledgedAt ? 'is-read' : ''}`}>
      <div className="alert-card-head">
        <RiskBadge level={a.severity} />
        <time dateTime={a.createdAt}>{clock(a.createdAt)}</time>
      </div>
      <h2 className="alert-title">{alertHeadline(a)}</h2>
      <p className="alert-meta">
        {a.produce} · {a.code} · <strong>{hours(a.remainingHours)} h left</strong>
        {a.markdownPct !== null && a.recommendedPricePerKg !== null && (
          <>
            {' '}
            · {a.markdownPct}% off → {rupees(a.recommendedPricePerKg)}/kg
          </>
        )}
      </p>
      <p className="alert-delivery">
        Sent to {a.recipient} · SMS / WhatsApp — simulated
        <InfoTip about="delivery" text="No real message is sent. A production build would hand this alert to an SMS or WhatsApp provider." />
      </p>
      <div className="alert-ack">
        {a.acknowledgedAt ? (
          <p className="ack-done">
            <span className="check" aria-hidden="true">
              ✓
            </span>{' '}
            Acknowledged {clock(a.acknowledgedAt)}
          </p>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onAcknowledge}>
            {busy ? 'Recording…' : 'Acknowledge'}
          </button>
        )}
      </div>
    </li>
  );
}
