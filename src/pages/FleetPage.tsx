import { useState } from 'react';
import { RISK_ORDER, type RiskLevel } from '../../server/config';
import { fetchShipments, type ShipmentSummary } from '../api';
import { MiniGauge } from '../components/MiniGauge';
import { RiskBadge } from '../components/RiskBadge';
import { riskCounts, sortFleet, type FleetSort } from '../fleet';
import { rupees } from '../format';
import { useChangeStream } from '../live';
import { usePoll } from '../poll';
import { controlTowerLink } from '../selection';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../ui/layout';

const SORTS: Array<{ id: FleetSort; label: string }> = [
  { id: 'risk', label: 'Highest risk first' },
  { id: 'code', label: 'By code' },
];

/** Every shipment on the road, most urgent first. Each figure is read from the server. */
export function FleetPage() {
  const { data, error, loading, reload } = usePoll(fetchShipments, 5000);
  useChangeStream(() => reload());
  const [sort, setSort] = useState<FleetSort>('risk');

  const fleet = data ? sortFleet(data, sort) : [];
  const counts = data ? riskCounts(data) : null;
  const levels = (Object.keys(RISK_ORDER) as RiskLevel[]).sort((a, b) => RISK_ORDER[b] - RISK_ORDER[a]);

  return (
    <section className="page" aria-labelledby="page-title">
      <PageHeader
        title="Fleet"
        subtitle={data ? `${data.length} ${data.length === 1 ? 'shipment' : 'shipments'} in transit` : undefined}
        actions={
          <div className="seg" role="group" aria-label="Sort shipments">
            {SORTS.map((s) => (
              <button key={s.id} type="button" className={`chip-btn ${sort === s.id ? 'is-active' : ''}`} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        }
      />

      {error && !data && <ErrorState title="We can't load the fleet" message={`${error} Check that the server is running, then try again.`} onRetry={reload} />}
      {error && data && (
        <p className="notice is-error" role="alert">
          Showing the last synced fleet. {error}
        </p>
      )}
      {loading && !data && (
        <div className="fleet-grid" role="status" aria-label="Loading the fleet">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={150} />
          ))}
        </div>
      )}

      {data && data.length === 0 && <EmptyState icon="fleet" title="No shipments yet" hint="Shipments appear here as soon as the server has them." />}

      {data && counts && data.length > 0 && (
        <>
          <ul className="fleet-summary" aria-label="Shipments by risk">
            {levels.map((level) => (
              <li key={level} className={`risk-${level} ${counts[level] === 0 ? 'is-zero' : ''}`}>
                <RiskBadge level={level} />
                <strong>{counts[level]}</strong>
              </li>
            ))}
          </ul>

          <ul className="fleet-grid">
            {fleet.map((s) => (
              <li key={s.id}>
                <FleetCard shipment={s} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function FleetCard({ shipment: s }: { shipment: ShipmentSummary }) {
  return (
    <a className={`fleet-card risk-${s.riskLevel}`} href={controlTowerLink(s.id)} aria-label={`${s.produce}, ${s.code}. Open on the Control Tower.`}>
      <MiniGauge remaining={s.remainingHours} baseline={s.baselineShelfLifeHours} level={s.riskLevel} />
      <div className="fleet-body">
        <p className="fleet-produce">{s.produce}</p>
        <p className="fleet-code">{s.code}</p>
        <RiskBadge level={s.riskLevel} />
        <p className="fleet-facts">
          <span>
            <strong>{s.currentTemperature.toFixed(1)}</strong> °C
          </span>
          <span>{rupees(s.currentPricePerKg)}/kg</span>
        </p>
      </div>
    </a>
  );
}
