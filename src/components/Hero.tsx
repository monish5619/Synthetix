import { useEffect, useRef, useState } from 'react';
import type { ShipmentDetail } from '../../server/pipeline';
import { hours, signedHours } from '../format';
import { useTween } from '../hooks';
import { CountUp } from '../ui/CountUp';
import { InfoTip } from '../ui/InfoTip';
import { Badge } from '../ui/layout';
import { RouteMap } from './RouteMap';
import { ShelfGauge } from './ShelfGauge';

interface Props {
  state: ShipmentDetail;
  /** Milliseconds to hold the previous numbers while the story reveal plays. */
  holdMs: number;
}

/** The headline of the page: the gauge, the live conditions, and the road. */
export function Hero({ state, holdMs }: Props) {
  const { current } = state;
  const level = current.riskLevel;
  // One sweep when the risk first reaches critical. It marks the moment, then gets out of the way.
  const [sweep, setSweep] = useState(false);
  const previous = useRef(level);
  useEffect(() => {
    if (level === 'CRITICAL' && previous.current !== 'CRITICAL') {
      setSweep(true);
      const t = window.setTimeout(() => setSweep(false), 1400);
      previous.current = level;
      return () => window.clearTimeout(t);
    }
    previous.current = level;
  }, [level]);

  const remaining = useTween(current.remainingHours, { duration: 900, delay: holdMs });
  const transit = useTween(current.transitRemainingHours, { duration: 900, delay: holdMs });
  const arrivalMargin = remaining - transit;
  const spoilsFirst = current.remainingHours - current.transitRemainingHours < 0;

  return (
    <section className={`ct-hero risk-${level} ${sweep ? 'is-sweeping' : ''}`} aria-label="Remaining shelf life">
      <div className="ct-hero-main">
        <ShelfGauge state={state} holdMs={holdMs} />

        <dl className="metrics">
          <div className="metric">
            <dt>Temperature</dt>
            <dd>
              <CountUp value={current.temperature} decimals={1} delay={holdMs} />
              <small>°C</small>
            </dd>
          </div>
          <div className="metric">
            <dt>Humidity</dt>
            <dd>
              <CountUp value={current.humidity} decimals={0} delay={holdMs} />
              <small>% RH</small>
            </dd>
          </div>
          <div className="metric">
            <dt>Transit left</dt>
            <dd>
              {hours(transit)}
              <small>h</small>
            </dd>
          </div>
          <div className={`metric metric-margin ${spoilsFirst ? 'is-bad' : ''}`}>
            <dt>
              Arrival margin
              <InfoTip about="arrival margin" text="Remaining shelf life minus the transit time still to run. Negative means the produce spoils before it arrives." />
            </dt>
            <dd>{signedHours(arrivalMargin)}</dd>
            <Badge tone={spoilsFirst ? 'critical' : 'safe'}>{spoilsFirst ? 'Spoils before arrival' : 'Arrives fresh'}</Badge>
          </div>
        </dl>
      </div>

      <RouteMap state={state} />
    </section>
  );
}
