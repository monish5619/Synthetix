import type { ShipmentDetail } from '../../server/pipeline';
import { rupees } from '../format';
import { useTween } from '../hooks';

const URGENCY: Record<string, string> = {
  MONITOR: 'Monitor',
  PRIORITY: 'Priority',
  IMMEDIATE: 'Immediate',
};

export function Liquidation({ state }: { state: ShipmentDetail }) {
  const { listing, recommendations, current } = state;
  const rec = recommendations[0];
  const discounted = listing.discountPct > 0;
  const price = useTween(listing.currentPricePerKg, { duration: 900, delay: 350 });
  const critical = current.riskLevel === 'CRITICAL';

  if (!rec) {
    return (
      <section className="panel liquidation is-quiet" aria-labelledby="liq-title">
        <p className="eyebrow" id="liq-title">
          Liquidation decision
        </p>
        <p className="quiet-title">Sell at the normal price</p>
        <p className="quiet">
          No markdown is recommended at {current.riskLevel === 'NORMAL' ? 'low' : 'this'} risk. A recommendation appears
          when risk moves above low.
        </p>
        <div className="price-line">
          <span className="price-now">{rupees(listing.currentPricePerKg)}</span>
          <span className="unit">/ kg · normal price</span>
        </div>
      </section>
    );
  }

  return (
    <section className={`panel liquidation ${critical ? 'is-critical' : ''}`} aria-labelledby="liq-title">
      <p className="eyebrow" id="liq-title">
        Liquidation decision · urgency {URGENCY[rec.urgency] ?? rec.urgency}
      </p>
      <h2 className="liq-headline">{critical ? 'Liquidate before spoilage' : 'Liquidation recommended'}</h2>

      <div className="price-pair">
        <div className="price-block">
          <span className="price-caption">Original</span>
          <span className="price-old">{rupees(rec.originalPricePerKg)}</span>
          <span className="unit">/ kg</span>
        </div>
        <span className="price-arrow" aria-hidden="true">
          →
        </span>
        <div className="price-block is-new">
          <span className="price-caption">Recommended</span>
          <span className="price-new" aria-live="polite">
            {rupees(Math.round(price * 100) / 100)}
          </span>
          <span className="unit">/ kg</span>
        </div>
        <div className="markdown">
          <span className="markdown-value">{rec.markdownPct}%</span>
          <span className="markdown-label">markdown</span>
        </div>
      </div>

      <p className="liq-reason">
        <span className="reason-label">Why?</span> {rec.reason}
      </p>
      <dl className="liq-facts">
        <div>
          <dt>Sell by</dt>
          <dd>~{rec.sellByHours} h</dd>
        </div>
        <div>
          <dt>Listing</dt>
          <dd>{discounted ? `${listing.status.toLowerCase()} · −${listing.discountPct}%` : 'normal'}</dd>
        </div>
      </dl>
      <p className="retailer-action">{rec.retailerAction}</p>
    </section>
  );
}
