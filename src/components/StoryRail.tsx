import type { ShipmentDetail } from '../../server/pipeline';
import { hours } from '../format';
import { ROUTE_HREF, type Route } from '../route';
import { Icon, type GlyphName } from '../ui/icons';

export interface Stage {
  key: string;
  /** One word: the step. */
  step: string;
  icon: GlyphName;
  value: string;
  /** Two words at most. */
  label: string;
  /** True when the stored records show this step has happened. */
  lit: boolean;
  /** Where the full detail lives, so it is not repeated here. */
  link?: Route;
}

/**
 * The consequence chain for this shipment, read from the stored state. A step is lit
 * only when a backend record shows it happened. Nothing is scripted, and the figures
 * the liquidation card owns (markdown, price, reason) are deliberately not repeated
 * here: this row links to them instead.
 */
export function storyStages(state: ShipmentDetail): Stage[] {
  const { current, listing, recommendations, alerts, telemetry, latestModelRun, snapshots } = state;
  const reading = telemetry.at(-1);
  const rec = recommendations[0];
  // snapshots[0] is the baseline; anything after it is a real model run.
  const modelRan = snapshots.length > 1 && latestModelRun !== null;

  return [
    {
      key: 'telemetry',
      step: 'Telemetry',
      icon: 'telemetry',
      value: reading ? `${reading.temperature.toFixed(1)} °C` : '—',
      label: 'Sensor reading',
      lit: telemetry.length > 0,
      link: 'telemetry',
    },
    {
      key: 'model',
      step: 'Model',
      icon: 'model',
      value: modelRan ? `×${latestModelRun.temperatureStress.toFixed(2)}` : '—',
      label: 'Thermal stress',
      lit: modelRan,
    },
    {
      key: 'ageing',
      step: 'Ageing',
      icon: 'clock',
      value: `${hours(current.cumulativeEquivalentAge)} h`,
      label: 'Equivalent ageing',
      lit: current.cumulativeEquivalentAge > 0,
    },
    {
      key: 'risk',
      step: 'Risk',
      icon: 'alerts',
      value: current.riskLevel,
      label: 'Risk level',
      lit: current.riskLevel !== 'NORMAL',
    },
    {
      key: 'price',
      step: 'Price',
      icon: 'tag',
      value: listing.discountPct > 0 ? 'Repriced' : 'Normal',
      label: 'Marketplace listing',
      lit: listing.discountPct > 0,
      link: 'marketplace',
    },
    {
      key: 'alert',
      step: 'Alert',
      icon: 'bell',
      value: alerts.length > 0 ? `${alerts.length} raised` : 'None',
      label: 'Retailer alert',
      lit: alerts.length > 0,
      link: 'alerts',
    },
    {
      key: 'rescue',
      step: 'Rescue',
      icon: 'lifebuoy',
      value: rec ? `${rec.sellByHours} h` : '—',
      label: 'Sell window',
      lit: Boolean(rec),
    },
  ];
}

interface Props {
  state: ShipmentDetail;
  /** How many steps are revealed so far. Steps beyond this stay unlit while the reveal plays. */
  revealed: number;
}

export function StoryRail({ state, revealed }: Props) {
  const stages = storyStages(state);
  const current = lastLit(stages, revealed);
  return (
    <section className="chain" aria-label="What happens to this shipment">
      <ol className="chain-list">
        {stages.map((s, i) => {
          const visible = s.lit && i < revealed;
          const body = (
            <>
              <span className="chain-icon">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="chain-step">{s.step}</span>
              <span className="chain-value">{visible ? s.value : '—'}</span>
              <span className="chain-label">{s.label}</span>
            </>
          );
          return (
            <li
              key={s.key}
              className={`chain-item ${visible ? 'is-lit' : 'is-dark'} ${s.key === 'risk' && visible ? `risk-${state.current.riskLevel}` : ''}`}
              aria-current={visible && i === current ? 'step' : undefined}
            >
              {s.link && visible ? (
                <a className="chain-link" href={ROUTE_HREF[s.link]}>
                  {body}
                </a>
              ) : (
                <div className="chain-link">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Index of the furthest revealed, lit step. Used to mark the current point in the chain. */
export function lastLit(stages: Stage[], revealed: number): number {
  let idx = -1;
  stages.forEach((s, i) => {
    if (s.lit && i < revealed) idx = i;
  });
  return idx;
}
