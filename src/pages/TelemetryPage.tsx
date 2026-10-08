import { fetchShipment, fetchShipments, fetchTelemetryHistory, type HistoryEntry } from '../api';
import type { ShipmentDetail } from '../../server/pipeline';
import { AuditTimeline } from '../components/AuditTimeline';
import { RISK_COPY, clock, hours } from '../format';
import { usePoll } from '../poll';

interface Bundle {
  shipment: ShipmentDetail;
  entries: HistoryEntry[];
}

async function loadBundle(): Promise<Bundle> {
  const list = await fetchShipments();
  if (list.length === 0) throw new Error('No shipments are persisted on the server.');
  const id = list[0].id;
  const [shipment, entries] = await Promise.all([fetchShipment(id), fetchTelemetryHistory(id)]);
  return { shipment, entries };
}

const NO_FRESH = new Set<string>();

export function TelemetryPage() {
  const { data, error, loading, syncedAt } = usePoll(loadBundle, 4000);

  return (
    <section className="page" aria-labelledby="tel-title">
      <header className="page-head">
        <div>
          <p className="eyebrow">Telemetry · {data?.shipment.shipment.code ?? 'shipment'}</p>
          <h1 id="tel-title">History and operations</h1>
        </div>
        <span className="panel-meta">
          {syncedAt ? `Synced ${clock(syncedAt.toISOString())} · refreshes every 4 s` : 'Loading…'}
        </span>
      </header>

      {error && (
        <p className="notice is-error" role="alert">
          {data ? `Showing the last synced records. ${error}` : error}
        </p>
      )}
      {loading && !data && <p className="quiet" role="status">Loading telemetry from the database…</p>}

      {data && (
        <div className="split">
          <section className="panel-plain" aria-labelledby="hist-title">
            <h2 id="hist-title">Telemetry history</h2>
            <p className="quiet">Each reading with the shelf-life snapshot it produced.</p>
            {data.entries.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">No readings yet</p>
                <p>Run the spike or a normal reading on the Control Tower to record telemetry.</p>
              </div>
            ) : (
              <ol className="history">
                {data.entries.map((e) => {
                  const excursion = e.kind === 'THERMAL_EXCURSION';
                  return (
                    <li key={e.id} className={`history-item ${excursion ? 'is-excursion' : 'is-normal'}`}>
                      <time dateTime={e.recordedAt}>{clock(e.recordedAt)}</time>
                      <div className="history-body">
                        <span className="kind">{excursion ? 'Thermal excursion' : 'Normal telemetry'}</span>
                        <div className="history-readings">
                          <span>
                            <strong>{e.temperature.toFixed(1)}</strong> °C
                          </span>
                          <span>
                            <strong>{e.humidity.toFixed(0)}</strong>% RH
                          </span>
                          <span>
                            <strong>{e.exposureHours.toFixed(1)}</strong> h exposure
                          </span>
                          {e.remainingHours !== null && (
                            <span className="history-remaining">
                              <strong>{hours(e.remainingHours)}</strong> h remaining
                            </span>
                          )}
                        </div>
                        {e.riskLevel && <span className={`risk-tag risk-${e.riskLevel}`}>{RISK_COPY[e.riskLevel].label}</span>}
                        {e.explanation && <p className="history-note">{e.explanation}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="panel-plain" aria-labelledby="ops-title">
            <h2 id="ops-title">Operational event timeline</h2>
            <p className="quiet">Every event the backend recorded for this shipment, oldest first.</p>
            <AuditTimeline entries={data.shipment.audit} fresh={NO_FRESH} />
          </section>
        </div>
      )}
    </section>
  );
}
