import { fetchMarketplace, type MarketplaceListing, type Urgency } from '../api';
import { RISK_COPY, clock, daysLabel, hours, rupees } from '../format';
import { usePoll } from '../poll';

const URGENCY_LABEL: Record<Urgency, string> = {
  NONE: '—',
  MONITOR: 'Monitor',
  PRIORITY: 'Priority',
  IMMEDIATE: 'Immediate',
};

/** B2B listings read from the marketplace table. Refreshes every few seconds, so a spike on the control tower reprices it here. */
export function MarketplacePage() {
  const { data, error, loading, syncedAt } = usePoll(fetchMarketplace, 4000);

  return (
    <section className="page" aria-labelledby="mp-title">
      <header className="page-head">
        <div>
          <p className="eyebrow">B2B produce marketplace</p>
          <h1 id="mp-title">Listings</h1>
        </div>
        <span className="panel-meta">
          {syncedAt ? `Synced ${clock(syncedAt.toISOString())} · refreshes every 4 s` : 'Loading listings…'}
        </span>
      </header>

      {error && (
        <p className="notice is-error" role="alert">
          {data ? `Showing the last synced listings. ${error}` : error}
        </p>
      )}

      {loading && !data && <p className="quiet" role="status">Loading listings from the marketplace…</p>}

      {data && data.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No listings yet</p>
          <p>A listing appears when a shipment is created. Listings are not created in the browser.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="table-wrap">
          <table className="market-table">
            <thead>
              <tr>
                <th scope="col">Produce</th>
                <th scope="col">Origin → destination</th>
                <th scope="col">Remaining shelf life</th>
                <th scope="col">Risk</th>
                <th scope="col" className="num">Original</th>
                <th scope="col" className="num">Current</th>
                <th scope="col" className="num">Markdown</th>
                <th scope="col" className="num">Available</th>
                <th scope="col">Urgency</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <ListingRow key={l.listingId} listing={l} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ListingRow({ listing: l }: { listing: MarketplaceListing }) {
  const discounted = l.discountPct > 0;
  const risk = RISK_COPY[l.riskLevel];
  return (
    <tr className={discounted ? 'is-liquidation' : ''}>
      <td data-label="Produce">
        <span className="cell-main">{l.produce}</span>
        <span className="cell-sub">{l.code}</span>
      </td>
      <td data-label="Origin → destination">
        <span className="cell-main">{l.origin}</span>
        <span className="cell-sub">→ {l.destination}</span>
      </td>
      <td data-label="Remaining shelf life">
        <span className="cell-num">{hours(l.remainingHours)} h</span>
        <span className="cell-sub">{daysLabel(l.remainingHours)}</span>
      </td>
      <td data-label="Risk">
        <span className={`risk-tag risk-${l.riskLevel}`}>
          <span className="risk-tag-dot" aria-hidden="true" />
          {risk.label}
          <span className="risk-tag-code">{risk.short}</span>
        </span>
      </td>
      <td data-label="Original" className="num">
        {rupees(l.originalPricePerKg)}
        <span className="cell-sub">/kg</span>
      </td>
      <td data-label="Current" className="num">
        <span key={l.currentPricePerKg} className="price-flash">
          <strong>{rupees(l.currentPricePerKg)}</strong>
        </span>
        <span className="cell-sub">/kg</span>
      </td>
      <td data-label="Markdown" className="num">
        {discounted ? <span className="markdown-tag">−{l.discountPct}%</span> : <span className="cell-sub">none</span>}
      </td>
      <td data-label="Available" className="num">
        {l.availableKg.toLocaleString()} kg
        <span className="cell-sub">{discounted ? 'liquidation listing' : 'normal listing'}</span>
      </td>
      <td data-label="Urgency">
        <span className={`urgency urgency-${l.urgency.toLowerCase()}`}>{URGENCY_LABEL[l.urgency]}</span>
      </td>
    </tr>
  );
}
