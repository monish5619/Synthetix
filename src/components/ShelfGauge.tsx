import type { CSSProperties } from 'react';
import type { ShipmentDetail } from '../../server/pipeline';
import { hours } from '../format';
import { useTween } from '../hooks';
import { RISK_VISUAL } from '../risk';
import { GAUGE, arcPath, gaugeGeometry } from '../visual/gauge';
import { RiskBadge } from './RiskBadge';

interface Props {
  state: ShipmentDetail;
  /** Milliseconds to hold the previous value while the story sequence plays. */
  holdMs: number;
}

/**
 * The one thing the eye should land on: remaining shelf life, as a radial gauge.
 * The arc is the share of the reference life still left, in the colour of the
 * current risk band; the ticks are the band edges on the same scale. The number
 * and the risk word (with its own icon) say the same thing without colour.
 * Every value comes from the API.
 */
export function ShelfGauge({ state, holdMs }: Props) {
  const { current, shipment, model } = state;
  const level = current.riskLevel;
  const geo = gaugeGeometry({
    remaining: current.remainingHours,
    baseline: shipment.baselineShelfLifeHours,
    edges: [model.riskBands.criticalBelowHours, model.riskBands.watchAboveHours, model.riskBands.normalAboveHours],
  });
  const shown = useTween(current.remainingHours, { duration: 900, delay: holdMs });
  const style = { '--gauge': `var(${RISK_VISUAL[level].tone})`, '--hold': `${holdMs}ms` } as CSSProperties;

  return (
    <div className={`gauge risk-${level}`} style={style}>
      <svg className="gauge-svg" viewBox={`0 0 ${GAUGE.size} ${GAUGE.size}`} aria-hidden="true" focusable="false">
        <path d={arcPath()} pathLength={100} className="gauge-track" />
        <path
          d={arcPath()}
          pathLength={100}
          className="gauge-fill"
          strokeDasharray="100 100"
          style={{ strokeDashoffset: geo.dashOffset }}
        />
        {geo.ticks.map((t) => (
          <g key={t.hours}>
            <line x1={t.inner.x} y1={t.inner.y} x2={t.outer.x} y2={t.outer.y} className="gauge-tick" />
            <text x={t.label.x} y={t.label.y} className="gauge-tick-label" textAnchor="middle" dominantBaseline="middle">
              {t.hours}
            </text>
          </g>
        ))}
      </svg>

      <div className="gauge-center">
        <span className="visually-hidden" aria-live="polite">
          {`Remaining shelf life ${hours(current.remainingHours)} hours of ${shipment.baselineShelfLifeHours}. Risk ${level}.`}
        </span>
        <p className="gauge-eyebrow" aria-hidden="true">
          Shelf life left
        </p>
        <p className="gauge-value" aria-hidden="true">
          {shown.toFixed(1)}
          <span className="gauge-unit">h</span>
        </p>
        <RiskBadge level={level} />
      </div>
    </div>
  );
}
