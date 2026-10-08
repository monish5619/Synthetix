import type { ShipmentDetail } from '../../server/pipeline';
import { hours, multiplier } from '../format';
import { InfoTip } from '../ui/InfoTip';

/** One tile of the chain: a label, one big number, and the rule that produced it. */
function Tile({ label, value, rule, tone }: { label: string; value: string; rule?: string; tone?: 'hot' | 'bad' }) {
  return (
    <li className={`why-tile ${tone ? `is-${tone}` : ''}`}>
      <span className="why-label">{label}</span>
      <strong className="why-value">{value}</strong>
      {rule && <span className="why-rule">{rule}</span>}
    </li>
  );
}

/**
 * "Why did shelf life drop?" as a chain of numbers, left to right:
 * reading → multipliers → ageing → remaining. Every value is read from the stored model
 * run and the server's model configuration; nothing is computed for display.
 */
export function WhyDrop({ state }: { state: ShipmentDetail }) {
  const { latestModelRun: run, current, model, shipment } = state;
  if (!run) {
    return (
      <section className="why" aria-labelledby="why-title">
        <h2 id="why-title" className="card-title">Why did shelf life drop?</h2>
        <p className="quiet">No reading yet. Commit one and the model's working appears here.</p>
      </section>
    );
  }
  const base = shipment.baselineShelfLifeHours;
  const cumulative = current.cumulativeEquivalentAge;
  return (
    <section className="why" aria-labelledby="why-title">
      <header className="why-head">
        <h2 id="why-title" className="card-title">Why did shelf life drop?</h2>
        <InfoTip about="the model" text={`Deterministic model ${model.modelVersion}. No ML: the same reading always gives the same answer. Values come from the stored model run.`} side="bottom-end" />
      </header>

      <ol className="why-chain" aria-label="Model working, step by step">
        <Tile label="Temperature" value={`${run.temperatureC.toFixed(1)} °C`} rule={`ideal ${model.idealTemperatureC} °C`} />
        <Tile label="Humidity" value={`${run.humidityPct.toFixed(0)}% RH`} rule={`threshold ${model.humidityThresholdPct}%`} />
        <Tile label="Q10" value={String(model.q10)} rule="ageing × per +10 °C" />
        <Tile label="Temperature ×" value={multiplier(run.temperatureStress)} rule="Q10 ^ ((T − 4) / 10)" tone={run.temperatureStress > 1.5 ? 'hot' : undefined} />
        <Tile label="Humidity ×" value={multiplier(run.humidityFactor)} rule="1 + 0.02 × (RH − 60)" tone={run.humidityFactor > 1.2 ? 'hot' : undefined} />
        <Tile label="Ageing" value={`+${run.equivalentAgeIncrement.toFixed(2)} h`} rule={`${run.exposureHours.toFixed(1)} h × ${run.temperatureStress.toFixed(2)} × ${run.humidityFactor.toFixed(2)}`} tone={run.equivalentAgeIncrement > 24 ? 'hot' : undefined} />
        <Tile label="Remaining" value={`${hours(current.remainingHours)} h`} rule={`${base} − ${hours(cumulative)}`} tone={current.riskLevel === 'CRITICAL' || current.riskLevel === 'HIGH' ? 'bad' : undefined} />
      </ol>

      <pre className="why-formula" aria-label="The formulas">
        {`stress    = Q10 ^ ((T − 4) / 10)
humidity  = 1 + 0.02 × (RH − 60)
ageing    = duration × stress × humidity
remaining = baseline − cumulative ageing`}
      </pre>
    </section>
  );
}
