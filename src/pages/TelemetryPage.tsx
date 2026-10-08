import { fetchShipment, fetchShipments, fetchTelemetryHistory, type HistoryEntry } from '../api';
import type { ShipmentDetail } from '../../server/pipeline';
import { AuditTimeline } from '../components/AuditTimeline';
import { RiskBadge } from '../components/RiskBadge';
import { clock, hours, multiplier } from '../format';
import { useChangeStream } from '../live';
import { usePoll } from '../poll';
import { pickShipment, selectedIdFromHash } from '../selection';
import { PageHeader } from '../ui/layout';

interface Bundle {
  shipment: ShipmentDetail;
  entries: HistoryEntry[];
}

async function loadBundle(): Promise<Bundle> {
  const list = await fetchShipments();
  if (list.length === 0) throw new Error('No shipments are persisted on the server.');
  const chosen = pickShipment(list, selectedIdFromHash(window.location.hash));
  if (!chosen) throw new Error('No shipments are persisted on the server.');
  const id = chosen.id;
  const [shipment, entries] = await Promise.all([fetchShipment(id), fetchTelemetryHistory(id)]);
  return { shipment, entries };
}

const NO_FRESH = new Set<string>();

export function TelemetryPage() {
  const { data, error, loading, syncedAt, reload } = usePoll(loadBundle, 4000);
  useChangeStream(() => reload());

  return (
    <section className="page" aria-labelledby="page-title">
      <PageHeader
        title="Telemetry"
        subtitle={data ? `${data.shipment.shipment.produce} · ${data.shipment.shipment.code}` : undefined}
        actions={<span className="panel-meta">{syncedAt ? `Synced ${clock(syncedAt.toISOString())}` : 'Loading…'}</span>}
      />

      {error && (
        <p className="notice is-error" role="alert">
          {data ? `Showing the last synced records. ${error}` : error}
        </p>
      )}
      {loading && !data && <p className="quiet" role="status">Loading telemetry from the database…</p>}

      {data && (
        <div className="split">
          <section className="panel-plain" aria-labelledby="hist-title">
            <h2 id="hist-title">Readings</h2>
            {data.entries.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">No readings yet</p>
                <p>Commit a reading on the Control Tower to record telemetry.</p>
              </div>
            ) : (
              <ol className="history">
                {[...data.entries].reverse().map((e) => (
                  <HistoryRow key={e.id} entry={e} />
                ))}
              </ol>
            )}
          </section>

          <section className="panel-plain" aria-labelledby="ops-title">
            <h2 id="ops-title">Events</h2>
            <AuditTimeline entries={data.shipment.audit} fresh={NO_FRESH} />
          </section>
        </div>
      )}
    </section>
  );
}

function HistoryRow({ entry: e }: { entry: HistoryEntry }) {
  const excursion = e.kind === 'THERMAL_EXCURSION';
  const chips: Array<[string, string]> = [];
  if (e.temperatureStress !== null) chips.push(['Temp', multiplier(e.temperatureStress)]);
  if (e.humidityFactor !== null) chips.push(['Humidity', multiplier(e.humidityFactor)]);
  if (e.equivalentAgeIncrement !== null) chips.push(['Ageing', `+${e.equivalentAgeIncrement.toFixed(2)} h`]);
  return (
    <li className={`history-item ${excursion ? 'is-excursion' : 'is-normal'} ${e.riskLevel ? `risk-${e.riskLevel}` : ''}`}>
      <time dateTime={e.recordedAt}>{clock(e.recordedAt)}</time>
      <div className="history-body">
        <div className="history-top">
          <span className="kind">
            <span aria-hidden="true">{excursion ? '🔥' : '❄'}</span> {excursion ? 'Thermal excursion' : 'Normal'}
          </span>
          {e.riskLevel && <RiskBadge level={e.riskLevel} />}
        </div>
        <div className="history-readings">
          <span><strong>{e.temperature.toFixed(1)}</strong> °C</span>
          <span><strong>{e.humidity.toFixed(0)}</strong>% RH</span>
          <span><strong>{e.exposureHours.toFixed(1)}</strong> h</span>
          {e.remainingHours !== null && (
            <span className="history-remaining"><strong>{hours(e.remainingHours)}</strong> h left</span>
          )}
        </div>
        {chips.length > 0 && (
          <ul className="age-chips" aria-label="Ageing contribution">
            {chips.map(([k, v]) => (
              <li key={k}><span>{k}</span> {v}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
