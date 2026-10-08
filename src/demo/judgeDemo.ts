import type { TelemetryPreview } from '../../server/preview';
import type { ShipmentDetail } from '../../server/pipeline';
import { AMBIENT_SPIKE } from '../../server/simulator';
import type { AlertItem, ClaimResult, MarketplaceListing, Reading, ScenarioResult } from '../api';
import { hours, multiplier, rupees } from '../format';

export type StepId = 'reset' | 'normal' | 'spike' | 'collapse' | 'markdown' | 'alert' | 'rescue';

export const DEMO_STEPS: ReadonlyArray<{ id: StepId; title: string }> = [
  { id: 'reset', title: 'Reset' },
  { id: 'normal', title: 'Normal shipment' },
  { id: 'spike', title: 'Temperature + humidity spike' },
  { id: 'collapse', title: 'Shelf life collapses' },
  { id: 'markdown', title: 'Automatic markdown' },
  { id: 'alert', title: 'Marketplace deal + alert' },
  { id: 'rescue', title: 'Rescue' },
];

/** Everything the demo needs from the server: the same endpoints the rest of the app uses. */
export interface DemoDeps {
  reset(shipmentId: string): Promise<ShipmentDetail>;
  preview(shipmentId: string, reading: Reading): Promise<TelemetryPreview>;
  spike(shipmentId: string): Promise<ScenarioResult>;
  marketplace(): Promise<MarketplaceListing[]>;
  alerts(): Promise<AlertItem[]>;
  claim(listingId: string): Promise<ClaimResult>;
  /** Pacing between steps, so people can follow. Tests pass an instant one. */
  wait(ms: number): Promise<void>;
}

export interface StepUpdate {
  id: StepId;
  status: 'active' | 'done';
  /** The one big figure for the step. Read from a server response. */
  headline?: string;
  /** Small supporting facts, also from server responses. */
  facts?: string[];
  /** The shipment as the server returned it, for the Control Tower to show. */
  state?: ShipmentDetail;
}

export class DemoError extends Error {
  constructor(
    readonly step: StepId,
    message: string,
  ) {
    super(message);
  }
}

const PAUSE_MS = 1800;

/**
 * Runs the story through the real backend: reset, spike, read the stored result, check that the
 * marketplace and alert exist, claim the deal. Nothing here computes a result: each headline is
 * copied from a server response, and a step fails loudly if the server did not produce what
 * the story needs (for example, no listing or no alert).
 */
export async function runJudgeDemo(shipmentId: string, deps: DemoDeps, emit: (u: StepUpdate) => void): Promise<void> {
  const at = async <T>(id: StepId, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      throw new DemoError(id, err instanceof TypeError ? 'Could not reach the AgroSense server.' : err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  // 1. Reset: the server restores the demo shipment.
  emit({ id: 'reset', status: 'active' });
  const fresh = await at('reset', () => deps.reset(shipmentId));
  emit({ id: 'reset', status: 'done', headline: 'Demo restored', state: fresh });
  await deps.wait(PAUSE_MS);

  // 2. The shipment as stored: a healthy reference life and a low risk. Nothing is written.
  emit({ id: 'normal', status: 'active' });
  emit({
    id: 'normal',
    status: 'done',
    headline: `${hours(fresh.current.remainingHours)} h · ${fresh.current.riskLevel}`,
    facts: [`${fresh.shipment.produce} · ${fresh.current.temperature.toFixed(1)} °C`],
    state: fresh,
  });
  await deps.wait(PAUSE_MS);

  // 3. The spike. The server first says what it would do (nothing saved), then it is committed.
  emit({ id: 'spike', status: 'active' });
  const preview = await at('spike', () => deps.preview(shipmentId, AMBIENT_SPIKE));
  emit({
    id: 'spike',
    status: 'active',
    headline: `${AMBIENT_SPIKE.temperature} °C · ${AMBIENT_SPIKE.humidity}% RH`,
    facts: [
      `Temperature ${multiplier(preview.model.temperatureStress)}`,
      `Humidity ${multiplier(preview.model.humidityFactor)}`,
      `+${preview.model.equivalentAgeIncrement.toFixed(1)} h ageing`,
    ],
  });
  await deps.wait(PAUSE_MS);
  const spiked = await at('spike', () => deps.spike(shipmentId));
  emit({
    id: 'spike',
    status: 'done',
    headline: `${AMBIENT_SPIKE.temperature} °C · ${AMBIENT_SPIKE.humidity}% RH`,
    facts: [
      `Temperature ${multiplier(spiked.shipment.latestModelRun?.temperatureStress ?? preview.model.temperatureStress)}`,
      `Humidity ${multiplier(spiked.shipment.latestModelRun?.humidityFactor ?? preview.model.humidityFactor)}`,
      `+${(spiked.shipment.latestModelRun?.equivalentAgeIncrement ?? preview.model.equivalentAgeIncrement).toFixed(1)} h ageing`,
    ],
    state: spiked.shipment,
  });
  await deps.wait(PAUSE_MS);

  // 4. The collapse, as stored.
  const after = spiked.shipment;
  emit({
    id: 'collapse',
    status: 'done',
    headline: `${hours(after.current.remainingHours)} h · ${after.current.riskLevel}`,
    facts: [`was ${hours(fresh.current.remainingHours)} h`],
    state: after,
  });
  await deps.wait(PAUSE_MS);

  // 5. The automatic markdown, from the stored recommendation.
  const rec = after.recommendations[0];
  if (!rec) throw new DemoError('markdown', 'The server did not create a markdown recommendation.');
  emit({
    id: 'markdown',
    status: 'done',
    headline: `${rec.markdownPct}% off · ${rupees(after.listing.currentPricePerKg)}/kg`,
    facts: [`was ${rupees(after.shipment.originalPricePerKg)}/kg`],
    state: after,
  });
  await deps.wait(PAUSE_MS);

  // 6. The deal and the alert must really exist in the marketplace and alerts tables.
  emit({ id: 'alert', status: 'active' });
  const [listings, alerts] = await at('alert', () => Promise.all([deps.marketplace(), deps.alerts()]));
  const listing = listings.find((l) => l.shipmentId === shipmentId);
  if (!listing || listing.discountPct <= 0) throw new DemoError('alert', 'The marketplace listing was not repriced.');
  const alert = alerts.find((a) => a.shipmentId === shipmentId);
  if (!alert) throw new DemoError('alert', 'The server did not create a retailer alert.');
  emit({
    id: 'alert',
    status: 'done',
    headline: `Deal live · ${rupees(listing.currentPricePerKg)}/kg`,
    facts: [`${alert.severity} alert recorded for ${alert.recipient}`, 'SMS / WhatsApp — simulated'],
  });
  await deps.wait(PAUSE_MS);

  // 7. The retailer rescues the stock. The server decreases the quantity.
  emit({ id: 'rescue', status: 'active' });
  const claim = await at('rescue', () => deps.claim(listing.listingId));
  emit({
    id: 'rescue',
    status: 'done',
    headline: 'RESCUED',
    facts: [`${claim.quantityKg.toLocaleString()} kg at ${rupees(claim.pricePerKg)}/kg = ${rupees(claim.totalValue)}`],
  });
}
