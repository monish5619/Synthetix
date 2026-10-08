import type { ShipmentDetail } from '../../server/pipeline';
import { RISK_COPY, hours, rupees } from '../format';

export interface Stage {
  key: string;
  title: string;
  value: string;
  detail: string;
  /** True when the stored records show this stage has happened. */
  lit: boolean;
}

/**
 * The consequence chain for this shipment, read from the stored state. A stage is lit
 * only when a backend record shows it happened. Nothing is scripted.
 */
export function storyStages(state: ShipmentDetail): Stage[] {
  const { current, shipment, listing, recommendations, alerts, model, telemetry } = state;
  const excursion = [...telemetry].reverse().find((t) => t.temperature > model.idealTemperatureC + model.excursionAboveIdealC);
  const rec = recommendations[0];
  const alert = alerts[0];
  const collapsed = current.remainingHours < shipment.baselineShelfLifeHours / 2;

  return [
    {
      key: 'healthy',
      title: 'Produce is healthy',
      value: `${shipment.baselineShelfLifeHours} h`,
      detail: `${shipment.produce} at ${model.idealTemperatureC} °C`,
      lit: true,
    },
    {
      key: 'thermal',
      title: 'Thermal event',
      value: excursion ? `${excursion.temperature.toFixed(0)} °C · ${excursion.humidity.toFixed(0)}% RH` : 'None recorded',
      detail: excursion ? `${excursion.transitDuration.toFixed(1)} h exposure` : 'Readings are within range',
      lit: Boolean(excursion),
    },
    {
      key: 'collapse',
      title: 'Shelf life collapses',
      value: `${hours(current.remainingHours)} h left`,
      detail: collapsed ? 'Under half of the reference life' : 'Above half of the reference life',
      lit: collapsed,
    },
    {
      key: 'risk',
      title: 'Risk increases',
      value: RISK_COPY[current.riskLevel].label,
      detail: `${hours(current.transitRemainingHours)} h of transit still to run`,
      lit: current.riskLevel !== 'NORMAL',
    },
    {
      key: 'decision',
      title: 'Business decision',
      value: rec ? `Liquidate · ${rec.markdownPct}% markdown` : 'No action needed',
      detail: rec ? rec.reason : 'The listing stays at the normal price',
      lit: Boolean(rec),
    },
    {
      key: 'liquidate',
      title: 'Marketplace reprices',
      value: listing.discountPct > 0 ? rupees(listing.currentPricePerKg) + '/kg' : rupees(listing.basePricePerKg) + '/kg',
      detail: listing.discountPct > 0 ? `was ${rupees(listing.basePricePerKg)}/kg` : 'Normal price',
      lit: listing.discountPct > 0,
    },
    {
      key: 'retailer',
      title: 'Retailer can act',
      value: alert ? `Alert to ${alert.recipient}` : 'No alert raised',
      detail: alert ? `${alert.severity} alert · recorded for the retailer` : 'Alerts are raised at high or critical risk',
      lit: Boolean(alert),
    },
  ];
}

interface Props {
  state: ShipmentDetail;
  /** How many stages are revealed so far. Stages beyond this stay unlit while the reveal plays. */
  revealed: number;
}

export function StoryRail({ state, revealed }: Props) {
  const stages = storyStages(state);
  return (
    <section className="story" aria-labelledby="story-title">
      <p className="eyebrow" id="story-title">
        What happens to this shipment
      </p>
      <ol className="story-rail">
        {stages.map((s, i) => {
          const visible = s.lit && i < revealed;
          const state = visible ? 'is-lit' : 'is-dark';
          return (
            <li key={s.key} className={`story-stage ${state}`} aria-current={visible && i === lastLit(stages, revealed) ? 'step' : undefined}>
              <span className="story-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="story-title">{s.title}</span>
              <span className="story-value">{visible ? s.value : '—'}</span>
              <span className="story-detail">{visible ? s.detail : ''}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Index of the furthest revealed, lit stage. Used to mark the current point in the story. */
function lastLit(stages: Stage[], revealed: number): number {
  let idx = -1;
  stages.forEach((s, i) => {
    if (s.lit && i < revealed) idx = i;
  });
  return idx;
}
