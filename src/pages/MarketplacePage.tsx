import { useState } from 'react';
import { claimListing, fetchMarketplace, type MarketplaceListing } from '../api';
import { dealReason, policyExplanation } from '../alerts';
import { MiniGauge } from '../components/MiniGauge';
import { RiskBadge } from '../components/RiskBadge';
import { hours, rupees } from '../format';
import { useChangeStream } from '../live';
import { usePoll } from '../poll';
import { InfoTip } from '../ui/InfoTip';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../ui/layout';

/** Deal cards read from the marketplace table. A spike on the Control Tower reprices them here. */
export function MarketplacePage() {
  const { data, error, loading, reload } = usePoll(fetchMarketplace, 4000);
  useChangeStream(() => reload());
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  async function claim(l: MarketplaceListing) {
    setClaiming(l.listingId);
    setClaimError(null);
    try {
      await claimListing(l.listingId);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'The claim could not be recorded. Nothing changed.');
    } finally {
      reload();
      setClaiming(null);
    }
  }

  // Deals first: biggest markdown, then least shelf life left.
  const deals = data ? [...data].sort((a, b) => b.discountPct - a.discountPct || a.remainingHours - b.remainingHours) : [];

  return (
    <section className="page" aria-labelledby="page-title">
      <PageHeader
        title="Marketplace"
        subtitle={data ? `${data.filter((l) => l.discountPct > 0).length} rescue deals · ${data.length} listings` : undefined}
        actions={<InfoTip about="automatic markdown" text={policyExplanation()} side="bottom-end" />}
      />

      {error && !data && <ErrorState title="We can't load the marketplace" message={`${error} Check that the server is running, then try again.`} onRetry={reload} />}
      {error && data && (
        <p className="notice is-error" role="alert">
          Showing the last synced listings. {error}
        </p>
      )}
      {claimError && (
        <p className="notice is-error" role="alert">
          {claimError}
        </p>
      )}
      {loading && !data && (
        <div className="deal-grid" role="status" aria-label="Loading listings">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={220} />
          ))}
        </div>
      )}
      {data && data.length === 0 && <EmptyState icon="market" title="No listings yet" hint="A listing appears when a shipment is created." />}

      {data && data.length > 0 && (
        <ul className="deal-grid">
          {deals.map((l) => (
            <li key={l.listingId}>
              <DealCard listing={l} busy={claiming === l.listingId} onClaim={() => claim(l)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DealCard({ listing: l, busy, onClaim }: { listing: MarketplaceListing; busy: boolean; onClaim: () => void }) {
  const discounted = l.discountPct > 0;
  const rescued = l.availableKg <= 0;
  return (
    <article className={`deal-card risk-${l.riskLevel} ${discounted ? 'is-deal' : ''} ${rescued ? 'is-rescued' : ''}`}>
      <header className="deal-head">
        <MiniGauge remaining={l.remainingHours} baseline={l.baselineShelfLifeHours} level={l.riskLevel} />
        <div className="deal-title">
          <h2>{l.produce}</h2>
          <p className="fleet-code">{l.code}</p>
          <RiskBadge level={l.riskLevel} />
        </div>
      </header>

      <p className="deal-reason">{dealReason(l.discountPct, l.riskLevel)}</p>

      <p className="deal-price">
        {discounted && <s aria-label={`was ${rupees(l.originalPricePerKg)} per kg`}>{rupees(l.originalPricePerKg)}</s>}
        <strong key={l.currentPricePerKg} className="price-flash">
          {rupees(l.currentPricePerKg)}
        </strong>
        <span>/kg</span>
      </p>

      <dl className="deal-facts">
        <div>
          <dt>Left</dt>
          <dd>{l.availableKg.toLocaleString()} kg</dd>
        </div>
        <div>
          <dt>Sell within</dt>
          <dd>{hours(l.remainingHours)} h</dd>
        </div>
      </dl>

      {rescued ? (
        <p className="deal-rescued" role="status">
          <span aria-hidden="true">✓</span> RESCUED · {l.claimedKg.toLocaleString()} kg
        </p>
      ) : (
        <button type="button" className="btn btn-primary deal-cta" disabled={busy} aria-busy={busy} onClick={onClaim}>
          {busy ? 'Claiming…' : discounted ? 'Rescue deal' : 'Claim'}
        </button>
      )}
      {!rescued && l.claimedKg > 0 && <p className="deal-partial">{l.claimedKg.toLocaleString()} kg already rescued</p>}
    </article>
  );
}
