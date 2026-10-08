import type { ShipmentDetail } from '../../server/pipeline';
import type { ScenarioResult } from '../api';
import { RISK_COPY, clamp, daysLabel, hours, multiplier, signedHours } from '../format';

import { useTween } from '../hooks';

export type SequenceStep = 0 | 1 | 2 | 3 | 4;

interface SequenceState {
  step: SequenceStep;
  result: ScenarioResult;
}

interface Props {
  state: ShipmentDetail;
  /** Set while a spike sequence is running. Null otherwise. */
  sequence: SequenceState | null;
}

const STEP_LABELS = [
  'Thermal event detected',
  'Analyzing exposure',
  'Shelf life impact',
  'Remaining shelf life',
  'Risk assessed',
] as const;

/** Holds the previous shelf-life number until the sequence reaches the reveal, then eases to the new value. */
const REVEAL_DELAY = 1150;

export function Hero({ state, sequence }: Props) {
  const { current, shipment } = state;
  const level = current.riskLevel;
  const risk = RISK_COPY[level];
  const remaining = useTween(current.remainingHours, { duration: 900, delay: sequence ? REVEAL_DELAY : 0 });
  const transit = useTween(current.transitRemainingHours, { duration: 900, delay: sequence ? REVEAL_DELAY : 0 });
  const arrivalMargin = remaining - transit;
  const reference = shipment.baselineShelfLifeHours;
  const step = sequence?.step ?? null;

  return (
    <section className={`hero risk-${level}`} aria-labelledby="hero-title">
      <div className="hero-core">
        <p className="eyebrow" id="hero-title">
          Remaining shelf life
        </p>

        <div className="hero-figure">
          <div className="hero-number" aria-live="polite" aria-label={`${remaining.toFixed(1)} hours remaining`}>
            <span className="hero-value">{remaining.toFixed(1)}</span>
            <span className="hero-unit">hours</span>
          </div>
          <p className="hero-days">
            {daysLabel(remaining)} at the current model estimate
          </p>
        </div>

        <div className="risk-line">
          <span className="risk-pip" aria-hidden="true" />
          <span className="risk-label">{risk.label}</span>
          <span className="risk-code">{risk.short}</span>
        </div>
        <p className="risk-note">{risk.note}</p>

        {sequence && <Sequence step={step ?? 0} result={sequence.result} />}
      </div>

      <aside className="conditions" aria-label="Current conditions">
        <Reading label="Temperature" value={current.temperature.toFixed(1)} unit="°C" />
        <Reading label="Humidity" value={current.humidity.toFixed(0)} unit="%" />
        <Reading label="Transit left" value={hours(transit)} unit="h" />
        <div className="reading reading-wide">
          <span className="reading-label">Arrival margin</span>
          <span className={`reading-value ${arrivalMargin < 0 ? 'is-bad' : ''}`}>
            {signedHours(arrivalMargin)}
          </span>
          <span className="reading-note">
            {arrivalMargin < 0 ? 'Produce spoils before it arrives.' : 'Produce arrives inside its shelf life.'}
          </span>
        </div>
      </aside>

      <div className="life-track" aria-label="Shelf life against remaining transit">
        <div className="track-labels">
          <span>0 h</span>
          <span>Shelf life {hours(remaining)} h</span>
          <span>{reference} h</span>
        </div>
        <div className="track">
          <div className="track-fill" style={{ width: `${clamp((remaining / reference) * 100)}%` }} />
          <div className="track-marker" style={{ left: `${clamp((transit / reference) * 100)}%` }}>
            <span>arrival · {hours(transit)} h</span>
          </div>
        </div>
      </div>
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

/** Reveals only facts from the backend response. Each line is data, not decoration. */
function Sequence({ step, result }: { step: number; result: ScenarioResult }) {
  const run = result.shipment.latestModelRun;
  const lines = [
    `${result.readings.temperature.toFixed(1)} °C · ${result.readings.humidity}% RH · ${result.readings.transitDuration} h exposure`,
    run ? `Thermal stress ${multiplier(run.temperatureStress)} · humidity factor ${multiplier(run.humidityFactor)}` : '',
    run ? `+${run.equivalentAgeIncrement.toFixed(2)} h of equivalent ageing` : '',
    `${hours(result.shipment.current.remainingHours)} hours remain`,
    `${RISK_COPY[result.shipment.current.riskLevel].label}`,
  ];
  return (
    <ol className="sequence" aria-live="polite">
      {STEP_LABELS.map((label, i) => (
        <li key={label} className={i < step ? 'is-done' : i === step ? 'is-active' : 'is-pending'}>
          <span className="sequence-step">{label}</span>
          <span className="sequence-detail">{i <= step ? lines[i] : ''}</span>
        </li>
      ))}
    </ol>
  );
}
