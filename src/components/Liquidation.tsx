import type { ShipmentDetail } from '../../server/pipeline';
import { rupees } from '../format';
import { useTween } from '../hooks';
import { ROUTE_HREF } from '../route';
import { CountUp } from '../ui/CountUp';
import { InfoTip } from '../ui/InfoTip';
import { Badge } from '../ui/layout';

const URGENCY: Record<string, string> = {
  MONITOR: 'Monitor',
  PRIORITY: 'Priority',
  IMMEDIATE: 'Immediate',
};

/**
 * The single home of the liquidation decision on this page: the markdown, the
 * prices and the reason are stated here once. The rest of the page points here
 * or to the Marketplace and Alerts pages instead of repeating them.
 */
export function Liquidation({ state }: { state: ShipmentDetail }) {
  const { listing, recommendations, current } = state;
  const rec = recommendations[0];
  const price = useTween(listing.currentPricePerKg, { duration: 900, delay: 350 });
  const critical = current.riskLevel === 'CRITICAL';

  if (!rec) {
    return (
      <section className="panel liquidation is-quiet" aria-labelledby="liq-title">
        <p className="eyebrow" id="liq-title">
          Liquidation
        </p>
        <p className="quiet-title">Normal price</p>
        <div className="price-line">
          <span className="price-now">{rupees(listing.currentPricePerKg)}</span>
          <span className="unit">/ kg</span>
        </div>
        <p className="quiet">No markdown at this risk.</p>
      </section>
    );
  }

  return (
    <section className={`panel liquidation ${critical ? 'is-critical' : ''}`} aria-labelledby="liq-title">
      <p className="eyebrow" id="liq-title">
        Liquidation · {URGENCY[rec.urgency] ?? rec.urgency}
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
          <span className="markdown-value">
            <CountUp value={rec.markdownPct} decimals={0} delay={350} />%
          </span>
          <span className="markdown-label">
            markdown
            <InfoTip about="markdown" text="Set by the markdown policy for the current risk level. Discounts only deepen; they never rise back." />
          </span>
        </div>
      </div>

      <p className="liq-reason">
        <span className="reason-label">Why</span> {rec.reason}
      </p>

      <p className="liq-links">
        <Badge tone="accent">{listing.status.toLowerCase()}</Badge>
        <a href={ROUTE_HREF.marketplace}>See the listing</a>
        <a href={ROUTE_HREF.alerts}>See the retailer alert</a>
      </p>
    </section>
  );
}
