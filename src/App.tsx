import { useEffect, useRef, useState } from 'react';
import type { ShipmentDetail as ShipmentState } from '../server/pipeline';
import type { RiskLevel } from '../server/config';
import { fetchShipment, fetchShipments, resetShipment, simulateNormal, simulateSpike, type ScenarioResult } from './api';
import { RISK_COPY, clock, daysAndHours, hours, multiplier, rupees } from './format';

/* ---------- run state for the primary action ---------- */

const STAGES = [
  'Telemetry received',
  'Thermal exposure analysed',
  'Shelf life recalculated',
  'Risk assessment updated',
  'Liquidation engine triggered',
] as const;

/** Checklist items. Each appears only if the backend actually recorded it for this run. */
const CONFIRMATIONS: Array<{ eventType: string; label: string }> = [
  { eventType: 'SHELF_LIFE_RECALCULATED', label: 'Shelf life recalculated' },
  { eventType: 'RISK_ESCALATED', label: 'Risk escalated' },
  { eventType: 'LIQUIDATION_RECOMMENDED', label: 'Liquidation triggered' },
  { eventType: 'MARKETPLACE_UPDATED', label: 'Marketplace updated' },
  { eventType: 'RETAILER_ALERT_GENERATED', label: 'Retailer alert generated' },
];

interface RunState {
  action: 'spike' | 'normal';
  phase: 'processing' | 'confirmed' | 'failed';
  stage: number;
  confirmations: string[];
  message?: string;
}

type Action = 'spike' | 'normal' | 'reset';

export function App() {
  const [state, setState] = useState<ShipmentState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seenAudit = useRef<Set<string> | null>(null);

  // The demo view shows the first persisted shipment. Nothing about it is hard-coded here.
  useEffect(() => {
    fetchShipments()
      .then(async (list) => {
        if (list.length === 0) throw new Error('No shipments found on the server.');
        setState(await fetchShipment(list[0].id));
        setSyncedAt(new Date());
      })
      .catch((err: unknown) => setError(messageOf(err)))
      .finally(() => setLoaded(true));
  }, []);

  // Highlight audit entries that arrived with the latest response.
  useEffect(() => {
    if (!state) return;
    const ids = new Set(state.audit.map((entry) => entry.id));
    if (seenAudit.current) {
      const added = [...ids].filter((id) => !seenAudit.current!.has(id));
      if (added.length > 0) setFresh(new Set(added));
    }
    seenAudit.current = ids;
  }, [state]);

  // Presentation only: advances the processing stage while the request is in flight.
  // It does not claim any step happened. Confirmations come from the backend response.
  useEffect(() => {
    if (run?.phase !== 'processing') return;
    const timer = setInterval(() => {
      setRun((r) => (r && r.phase === 'processing' ? { ...r, stage: Math.min(r.stage + 1, STAGES.length - 1) } : r));
    }, 320);
    return () => clearInterval(timer);
  }, [run?.phase]);

  /**
   * Primary action. The state only changes after the backend confirms success.
   * On failure, the UI shows the error and keeps the previous state.
   */
  async function runScenario(action: 'spike' | 'normal') {
    if (!state || busy) return;
    setBusy(action);
    setRun({ action, phase: 'processing', stage: 0, confirmations: [] });
    try {
      const call = action === 'spike' ? simulateSpike : simulateNormal;
      const result: ScenarioResult = await call(state.shipment.id);
      setState(result.shipment);
      setSyncedAt(new Date());
      setRun({ action, phase: 'confirmed', stage: STAGES.length - 1, confirmations: confirmationsFor(result) });
    } catch (err) {
      setRun({ action, phase: 'failed', stage: 0, confirmations: [], message: messageOf(err) });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!state || busy) return;
    setBusy('reset');
    setError(null);
    setRun(null);
    try {
      setState(await resetShipment(state.shipment.id));
      setSyncedAt(new Date());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  const level: RiskLevel = state?.current.riskLevel ?? 'NORMAL';

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <span className="wordmark">AgroSense</span>
          <span className="tagline">Predictive cold-chain intelligence</span>
        </div>
        {state && (
          <div className="shipment-meta">
            <span className="code">{state.shipment.code}</span>
            <span>{state.shipment.produce}</span>
            <span className="route">
              {state.shipment.origin} → {state.shipment.destination}
            </span>
          </div>
        )}
        <div className={`persist ${error ? 'is-bad' : ''}`} aria-live="polite">
          <span className="pulse" />
          {error ? 'Server unreachable' : 'Persisted to SQLite'}
          {syncedAt && !error && <span className="muted"> · synced {clock(syncedAt.toISOString())}</span>}
        </div>
      </header>

      {!state && (
        <div className="empty" role="status">
          {loaded ? error ?? 'Unable to load the shipment.' : 'Connecting to the control tower…'}
        </div>
      )}

      {state && (
        <>
          <Hero state={state} level={level} />

          <section className="control-band" aria-label="Telemetry controls">
            <div className="control-copy">
              <p className="eyebrow">Simulated telemetry · software only</p>
              <p>
                The server generates the reading, validates it, stores it, and runs the shelf-life model. No hardware
                involved.
              </p>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn btn-spike"
                disabled={busy !== null}
                onClick={() => runScenario('spike')}
              >
                {busy === 'spike' ? 'Processing…' : 'Simulate ambient temperature spike'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy !== null}
                onClick={() => runScenario('normal')}
              >
                {busy === 'normal' ? 'Processing…' : 'Normal reading'}
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={reset}>
                {busy === 'reset' ? 'Resetting…' : 'Reset demo'}
              </button>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {run && <RunPanel run={run} onRetry={() => runScenario(run.action)} busy={busy !== null} />}
          </section>

          <main className="grid">
            <Chain state={state} />
            <Market state={state} />
            <Trace state={state} />
            <Audit state={state} fresh={fresh} />
          </main>
        </>
      )}
    </div>
  );
}

/** Which backend records this run produced. Built from the response only. */
function confirmationsFor(result: ScenarioResult): string[] {
  const { event, shipment } = result;
  const persisted = shipment.telemetry.some((t) => t.id === event.id);
  const types = new Set(shipment.audit.filter((a) => a.createdAt === event.recordedAt).map((a) => a.eventType));
  const items = [persisted ? 'Telemetry persisted' : null];
  for (const c of CONFIRMATIONS) if (types.has(c.eventType)) items.push(c.label);
  return items.filter((x): x is string => x !== null);
}

function RunPanel({ run, onRetry, busy }: { run: RunState; onRetry: () => void; busy: boolean }) {
  if (run.phase === 'processing') {
    return (
      <div className="run-panel" role="status" aria-live="polite">
        <p className="eyebrow">Processing · {run.action === 'spike' ? 'ambient spike' : 'normal reading'}</p>
        <ol className="run-stages">
          {STAGES.map((label, i) => (
            <li key={label} className={i < run.stage ? 'is-done' : i === run.stage ? 'is-active' : ''}>
              {label}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (run.phase === 'failed') {
    return (
      <div className="run-panel is-failed" role="alert">
        <p className="eyebrow">Not confirmed</p>
        <p>
          The backend did not confirm this event. {run.message ? `${run.message} ` : ''}Nothing was changed.
        </p>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="run-panel is-confirmed" role="status">
      <p className="eyebrow">Confirmed by the backend</p>
      <ul className="run-confirms">
        {run.confirmations.map((label) => (
          <li key={label}>
            <span className="tick" aria-hidden="true">✓</span> {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Hero: shelf life, risk, life track ---------- */

function useTween(target: number, duration = 1100) {
  const [value, setValue] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    const begin = shown.current;
    if (begin === target) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = begin + (target - begin) * eased;
      shown.current = next;
      setValue(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

function Hero({ state, level }: { state: ShipmentState; level: RiskLevel }) {
  const { current, shipment } = state;
  const remaining = useTween(current.remainingHours);
  const transit = useTween(current.transitRemainingHours);
  const surplus = remaining - transit;

  return (
    <section className={`hero risk-${level}`} aria-label="Shelf life and risk">
      <div className="hero-main">
        <p className="eyebrow">Remaining shelf life</p>
        <div className="hero-number" aria-live="polite">
          <span>{remaining.toFixed(1)}</span>
          <small>h</small>
        </div>
        <p className="hero-sub">{daysAndHours(remaining)} from the model</p>
        <p className="conditions">
          Ambient <strong>{current.temperature.toFixed(1)} °C</strong> · <strong>{current.humidity.toFixed(0)}% RH</strong>
          <span className="muted"> · last reading</span>
        </p>
      </div>

      <div className="hero-side">
        <p className="eyebrow">Spoilage risk</p>
        <div className="risk-badge">{RISK_COPY[level].label}</div>
        <p className="hero-note">{RISK_COPY[level].note}</p>
        <dl className="facts">
          <div>
            <dt>Arrival margin</dt>
            <dd className={surplus < 0 ? 'is-bad' : ''}>
              {surplus >= 0 ? '+' : '−'}
              {Math.abs(surplus).toFixed(1)} h
            </dd>
          </div>
          <div>
            <dt>Transit left</dt>
            <dd>{hours(transit)} h</dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd>{shipment.quantityKg.toLocaleString()} kg</dd>
          </div>
        </dl>
      </div>

      <LifeTrack remaining={remaining} transit={transit} reference={shipment.baselineShelfLifeHours} />
    </section>
  );
}

function LifeTrack({ remaining, transit, reference }: { remaining: number; transit: number; reference: number }) {
  const shelfPct = clamp((remaining / reference) * 100);
  const transitPct = clamp((transit / reference) * 100);
  const beforeArrival = remaining < transit;
  return (
    <div className="life-track" aria-label="Shelf life against remaining transit">
      <div className="track-labels">
        <span>Shelf life {hours(remaining)} h</span>
        <span>Arrival in {hours(transit)} h</span>
      </div>
      <div className="track">
        <div className="track-fill" style={{ width: `${shelfPct}%` }} />
        <div className="track-marker" style={{ left: `${transitPct}%` }} />
      </div>
      <p className={`track-verdict ${beforeArrival ? 'is-bad' : ''}`}>
        {beforeArrival
          ? 'Produce will spoil before arrival unless it is sold early.'
          : 'Produce is expected to arrive inside its shelf life.'}
      </p>
    </div>
  );
}

/* ---------- Degradation chain: every step of the model, live ---------- */

function Chain({ state }: { state: ShipmentState }) {
  const { current, shipment, model, latestModelRun } = state;
  const temp = current.temperature;
  const rh = current.humidity;
  const remaining = useTween(current.remainingHours);
  const cumulative = useTween(current.cumulativeEquivalentAge);

  // The latest run explains the most recent interval. Before any telemetry it is the baseline.
  const stress = latestModelRun?.temperatureStress ?? 1;
  const humidity = latestModelRun?.humidityFactor ?? 1;
  const increment = latestModelRun?.equivalentAgeIncrement ?? 0;
  const exposure = latestModelRun?.exposureHours ?? 0;
  const reference = shipment.baselineShelfLifeHours;

  const steps = [
    {
      label: 'Ambient temperature',
      value: `${temp.toFixed(1)} °C`,
      detail: `ideal storage ${model.idealTemperatureC} °C`,
    },
    {
      label: 'Thermal stress',
      value: multiplier(stress),
      detail: `Q10 ${model.q10} ^ ((${temp.toFixed(1)} − ${model.idealTemperatureC}) ÷ 10)`,
    },
    {
      label: 'Humidity factor',
      value: multiplier(humidity),
      detail: `1 + ${model.humidityPenaltyPerPct} × max(0, ${rh.toFixed(0)} − ${model.humidityThresholdPct})`,
    },
    {
      label: 'Exposure interval',
      value: `${exposure.toFixed(1)} h`,
      detail: 'hours covered by the latest reading',
    },
    {
      label: 'Equivalent ageing added',
      value: `${increment.toFixed(2)} h`,
      detail: `${exposure.toFixed(1)} × ${stress.toFixed(2)} × ${humidity.toFixed(2)} × calibration ${model.calibrationCoefficient}`,
    },
    {
      label: 'Cumulative ageing',
      value: `${cumulative.toFixed(1)} h`,
      detail: `of ${reference} reference hours (${((cumulative / reference) * 100).toFixed(1)}% spent)`,
    },
    {
      label: 'Remaining shelf life',
      value: `${remaining.toFixed(1)} h`,
      detail: `max(0, ${reference} − ${cumulative.toFixed(1)})`,
    },
    {
      label: 'Risk level',
      value: RISK_COPY[current.riskLevel].label,
      detail: `critical < ${model.riskBands.criticalBelowHours} h · high < ${model.riskBands.watchAboveHours} h · watch < ${model.riskBands.normalAboveHours} h`,
    },
  ];

  return (
    <section className="panel chain" aria-labelledby="chain-title">
      <header className="panel-head">
        <h2 id="chain-title">Degradation chain</h2>
        <span className="panel-note">{current.modelVersion || model.modelVersion}</span>
      </header>
      <ThermalBar temp={temp} />
      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.label} className={i === steps.length - 1 ? 'step-final' : ''}>
            <span className="step-index">{String(i + 1).padStart(2, '0')}</span>
            <div className="step-body">
              <div className="step-line">
                <span className="step-label">{step.label}</span>
                <span className="step-value">{step.value}</span>
              </div>
              <p className="step-detail">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {current.explanation && <p className="explanation">{current.explanation}</p>}
    </section>
  );
}

function ThermalBar({ temp }: { temp: number }) {
  const pos = clamp((temp / 30) * 100);
  return (
    <div className="thermal" aria-label={`Temperature ${temp} degrees Celsius on a 0 to 30 scale`}>
      <div className="thermal-bar">
        <div className="thermal-marker" style={{ left: `${pos}%` }} />
      </div>
      <div className="thermal-scale">
        <span>0 °C</span>
        <span>10</span>
        <span>20</span>
        <span>30 °C</span>
      </div>
    </div>
  );
}

/* ---------- Marketplace: listing, recommendation, retailer alerts ---------- */

const URGENCY_LABEL: Record<string, string> = {
  MONITOR: 'Monitor',
  PRIORITY: 'Priority',
  IMMEDIATE: 'Immediate',
};

function Market({ state }: { state: ShipmentState }) {
  const { listing, recommendations, alerts, shipment } = state;
  const discounted = listing.discountPct > 0;
  const latest = recommendations[0];

  return (
    <section className="panel market" aria-labelledby="market-title">
      <header className="panel-head">
        <h2 id="market-title">Marketplace</h2>
        <span className={`status-tag ${discounted ? 'is-liquidation' : ''}`}>
          {discounted ? 'Liquidation recommended' : 'Normal price'}
        </span>
      </header>

      <div className="listing">
        <div>
          <p className="eyebrow">
            {shipment.produce} · {shipment.quantityKg.toLocaleString()} kg
          </p>
          <div className="price">
            {discounted && <s>{rupees(listing.basePricePerKg)}</s>}
            <span className="price-now">{rupees(listing.currentPricePerKg)}</span>
            <span className="unit">/ kg</span>
          </div>
        </div>
        {discounted && <div className="markdown">−{listing.discountPct}%</div>}
      </div>

      {latest ? (
        <div className="recommendation">
          <p className="eyebrow">Liquidation recommendation · {URGENCY_LABEL[latest.urgency] ?? latest.urgency}</p>
          <p className="rec-line">
            Sell by <strong>~{latest.sellByHours} h</strong> at {rupees(latest.recommendedPricePerKg)}/kg
          </p>
          <p className="rec-rationale">{latest.reason}</p>
          <p className="rec-action">{latest.retailerAction}</p>
        </div>
      ) : (
        <p className="quiet">No liquidation needed. Recommendations appear when risk moves above NORMAL.</p>
      )}

      <div className="alerts">
        <p className="eyebrow">Retailer alerts</p>
        {alerts.length === 0 && <p className="quiet">No alerts sent for this shipment.</p>}
        {alerts.map((alert) => (
          <article key={alert.id} className={`alert severity-${alert.severity.toLowerCase()}`}>
            <div className="alert-head">
              <span className="alert-severity">{RISK_COPY[alert.severity].label}</span>
              <span className="alert-to">to {alert.recipient}</span>
              <span className="muted">{clock(alert.createdAt)}</span>
            </div>
            <p>{alert.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------- Trace: temperature across telemetry events ---------- */

function Trace({ state }: { state: ShipmentState }) {
  const points = state.telemetry;
  const reference = state.shipment.idealTemperatureC;
  const width = 600;
  const height = 180;
  const pad = 24;
  const y = (t: number) => height - pad - (clamp(t, 0, 30) / 30) * (height - pad * 2);
  const x = (i: number) => (points.length <= 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2));
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.temperature).toFixed(1)}`)
    .join(' ');

  return (
    <section className="panel trace" aria-labelledby="trace-title">
      <header className="panel-head">
        <h2 id="trace-title">Telemetry trace</h2>
        <span className="panel-note">{points.length} readings stored</span>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Temperature readings over time">
        <line x1={pad} x2={width - pad} y1={y(reference)} y2={y(reference)} className="ref-line" />
        <text x={pad} y={y(reference) - 6} className="ref-label">
          ideal {reference} °C
        </text>
        {points.length > 0 && <path d={path} className="trace-line" />}
        {points.map((p, i) => (
          <g key={p.id}>
            <circle
              cx={x(i)}
              cy={y(p.temperature)}
              r={4.5}
              className={p.temperature > reference + 4 ? 'dot hot' : 'dot'}
            />
            <text x={x(i)} y={y(p.temperature) - 10} className="dot-label">
              {p.temperature.toFixed(0)}°
            </text>
          </g>
        ))}
        {points.length === 0 && (
          <text x={width / 2} y={height / 2} className="empty-trace" textAnchor="middle">
            Baseline only. Simulate an event to record telemetry.
          </text>
        )}
      </svg>
    </section>
  );
}

/* ---------- Audit trail ---------- */

function Audit({ state, fresh }: { state: ShipmentState; fresh: Set<string> }) {
  return (
    <section className="panel audit" aria-labelledby="audit-title">
      <header className="panel-head">
        <h2 id="audit-title">Audit trail</h2>
        <span className="panel-note">Newest first</span>
      </header>
      <ol className="audit-list">
        {state.audit.map((entry) => (
          <li key={entry.id} className={fresh.has(entry.id) ? 'is-new' : ''}>
            <time dateTime={entry.createdAt}>{clock(entry.createdAt)}</time>
            <div>
              <span className="event-type">{entry.eventType}</span>
              <p>{entry.summary}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- helpers ---------- */

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function messageOf(err: unknown): string {
  // A TypeError from fetch means the request never reached the server.
  if (err instanceof TypeError) return 'Could not reach the AgroSense server.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}
