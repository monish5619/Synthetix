import type { ShipmentDetail } from '../../server/pipeline';
import { RISK_COPY, daysLabel, hours, signedHours } from '../format';
import { useEffect, useRef, useState } from 'react';
import { useTween } from '../hooks';
import { Journey } from './Journey';

interface Props {
  state: ShipmentDetail;
  /** Milliseconds to hold the previous number while the story reveal plays. */
  holdMs: number;
}

/** The shelf-life number is the one thing the eye should land on. Everything else supports it. */
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
  const risk = RISK_COPY[level];
  const remaining = useTween(current.remainingHours, { duration: 900, delay: holdMs });
  const transit = useTween(current.transitRemainingHours, { duration: 900, delay: holdMs });
  const arrivalMargin = remaining - transit;

  return (
    <section className={`hero risk-${level} ${sweep ? 'is-sweeping' : ''}`} aria-labelledby="hero-title">
      <div className="hero-top">
        <div className="hero-core">
          <p className="eyebrow" id="hero-title">
            Remaining shelf life
          </p>
          <div className="hero-number" aria-live="polite" aria-label={`${remaining.toFixed(1)} hours remaining`}>
            <span className="hero-value">{remaining.toFixed(1)}</span>
            <span className="hero-unit">hours</span>
          </div>
          <p className="hero-days">{daysLabel(remaining)} at the model estimate</p>
          <div className="risk-line">
            <span className="risk-pip" aria-hidden="true" />
            <span className="risk-label">{risk.label}</span>
          </div>
          <p className="risk-note">{risk.note}</p>
        </div>

        <aside className="conditions" aria-label="Current conditions">
          <Reading label="Temperature" value={current.temperature.toFixed(1)} unit="°C" />
          <Reading label="Humidity" value={current.humidity.toFixed(0)} unit="% RH" />
          <Reading label="Transit left" value={hours(transit)} unit="h" />
          <div className="reading reading-wide">
            <span className="reading-label">Arrival margin</span>
            <span className={`reading-value ${arrivalMargin < 0 ? 'is-bad' : ''}`}>{signedHours(arrivalMargin)}</span>
            <span className="reading-note">
              {arrivalMargin < 0 ? 'Produce spoils before it arrives.' : 'Produce arrives inside its shelf life.'}
            </span>
          </div>
        </aside>
      </div>

      <Journey state={state} />
    </section>
  );
}

function Reading({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="reading">
      <span className="reading-label">{label}</span>
      <span className="reading-value">
        {value}
        <small>{unit}</small>
      </span>
    </div>
  );
}
