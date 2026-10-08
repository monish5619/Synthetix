import type { ShipmentDetail } from '../../server/pipeline';
import { RISK_COPY, clock, hours, multiplier } from '../format';

/**
 * Every value shown here comes from the backend. The latest model run is stored at
 * ingest time, and the parameters come from the server's configuration.
 */
export function Explain({ state }: { state: ShipmentDetail }) {
  const { current, latestModelRun: run, model, shipment } = state;
  const hasRun = run !== null;
  const temperature = run?.temperatureC ?? current.temperature;
  const humidity = run?.humidityPct ?? current.humidity;
  const stress = run?.temperatureStress ?? 1;
  const humidityFactor = run?.humidityFactor ?? 1;
  const exposure = run?.exposureHours ?? 0;
  const increment = run?.equivalentAgeIncrement ?? 0;
  const cumulative = current.cumulativeEquivalentAge;
  const reference = shipment.baselineShelfLifeHours;

  const rows: Array<{ term: string; value: string; note: string }> = [
    {
      term: 'Temperature',
      value: `${temperature.toFixed(1)} °C`,
      note: hasRun ? 'latest reading' : 'baseline, no readings yet',
    },
    { term: 'Ideal storage temperature', value: `${model.idealTemperatureC} °C`, note: 'product reference' },
    {
      term: 'Thermal stress',
      value: multiplier(stress),
      note: `Q10 ${model.q10} ^ ((${temperature.toFixed(1)} − ${model.idealTemperatureC}) ÷ 10)`,
    },
    { term: 'Humidity', value: `${humidity.toFixed(0)}% RH`, note: `threshold ${model.humidityThresholdPct}%` },
    {
      term: 'Humidity factor',
      value: multiplier(humidityFactor),
      note: `1 + ${model.humidityPenaltyPerPct} × max(0, ${humidity.toFixed(0)} − ${model.humidityThresholdPct})`,
    },
    { term: 'Exposure', value: `${exposure.toFixed(1)} h`, note: 'hours covered by the latest reading' },
    {
      term: 'Equivalent ageing added',
      value: `${increment.toFixed(2)} h`,
      note: `${exposure.toFixed(1)} × ${stress.toFixed(2)} × ${humidityFactor.toFixed(2)} × calibration ${model.calibrationCoefficient}`,
    },
    {
      term: 'Cumulative ageing',
      value: `${hours(cumulative)} h`,
      note: `of ${reference} h reference life`,
    },
    {
      term: 'Remaining shelf life',
      value: `${hours(current.remainingHours)} h`,
      note: `max(0, ${reference} − ${hours(cumulative)})`,
    },
    {
      term: 'Risk level',
      value: RISK_COPY[current.riskLevel].label,
      note: `critical < ${model.riskBands.criticalBelowHours} h · high < ${model.riskBands.watchAboveHours} h · moderate < ${model.riskBands.normalAboveHours} h`,
    },
  ];

  return (
    <details className="explain">
      <summary>
        <span className="explain-title">Why did shelf life change?</span>
        <span className="explain-hint">model {current.modelVersion || model.modelVersion} · values from the server</span>
      </summary>
      <div className="explain-body">
        <p className="explain-text">{current.explanation || 'No model run yet. The baseline is the reference life.'}</p>
        <dl className="explain-table">
          {rows.map((r) => (
            <div key={r.term} className="explain-row">
              <dt>{r.term}</dt>
              <dd className="explain-value">{r.value}</dd>
              <dd className="explain-note">{r.note}</dd>
            </div>
          ))}
        </dl>

        <IntervalBreakdown state={state} />
      </div>
    </details>
  );
}

/**
 * Every model run since the baseline, with the ageing it added. The total must equal
 * the stored cumulative ageing, so the table is a check as well as an explanation.
 */
function IntervalBreakdown({ state }: { state: ShipmentDetail }) {
  const intervals = state.snapshots.slice(1);
  const total = intervals.reduce((sum, s) => sum + s.equivalentAgeIncrement, 0);
  const matches = Math.abs(total - state.current.cumulativeEquivalentAge) < 0.01;

  if (intervals.length === 0) {
    return <p className="explain-text">No exposure intervals recorded yet. Ageing is zero.</p>;
  }

  return (
    <div className="breakdown">
      <p className="eyebrow">Ageing by interval</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Temperature</th>
            <th scope="col">Humidity</th>
            <th scope="col">Exposure</th>
            <th scope="col">Ageing added</th>
          </tr>
        </thead>
        <tbody>
          {intervals.map((s, i) => (
            <tr key={`${s.createdAt}-${i}`}>
              <td>{clock(s.createdAt)}</td>
              <td>{s.temperatureC.toFixed(1)} °C</td>
              <td>{s.humidityPct.toFixed(0)}%</td>
              <td>{s.exposureHours.toFixed(1)} h</td>
              <td>{s.equivalentAgeIncrement.toFixed(2)} h</td>
            </tr>
          ))}
          <tr className="breakdown-total">
            <th scope="row" colSpan={4}>
              Total · {matches ? 'matches cumulative ageing' : 'does not match cumulative ageing'}
            </th>
            <td>{total.toFixed(2)} h</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
