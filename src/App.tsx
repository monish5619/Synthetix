import { useEffect, useRef, useState } from 'react';
import type { ShipmentState } from '../server/pipeline';
import type { RiskLevel } from '../server/model';
import { AMBIENT_SPIKE, NORMAL_READING, type TelemetryPayload } from '../shared/scenarios';
import { fetchShipment, resetShipment, sendTelemetry } from './api';
import { RISK_COPY, clock, daysAndHours, hours, multiplier, rupees } from './format';

type Action = 'spike' | 'normal' | 'reset';

export function App() {
  const [state, setState] = useState<ShipmentState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seenAudit = useRef<Set<string> | null>(null);

  useEffect(() => {
    fetchShipment()
      .then((next) => {
        setState(next);
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

  async function run(action: Action, call: () => Promise<ShipmentState>) {
    setBusy(action);
    setError(null);
    try {
      setState(await call());
      setSyncedAt(new Date());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  const ingest = (payload: TelemetryPayload) =>
    state && run(payload === AMBIENT_SPIKE ? 'spike' : 'normal', () => sendTelemetry(state.shipment.id, payload));

  const reset = () => state && run('reset', () => resetShipment(state.shipment.id));

  const level: RiskLevel = state?.current.riskLevel ?? 'LOW';

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
                Readings go through the ingest API, are validated and stored, and recalculate the shelf-life model.
                No hardware involved.
              </p>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn btn-spike"
                disabled={busy !== null}
                onClick={() => ingest(AMBIENT_SPIKE)}
              >
                {busy === 'spike' ? 'Ingesting event…' : 'Simulate ambient temperature spike'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy !== null}
                onClick={() => ingest(NORMAL_READING)}
              >
                {busy === 'normal' ? 'Ingesting…' : 'Normal reading'}
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
  const shelf = useTween(current.remainingShelfLifeHours);
  const transit = useTween(current.transitRemainingHours);
  const margin = current.margin >= 99 ? '99+' : current.margin.toFixed(2);

  return (
    <section className={`hero risk-${level}`} aria-label="Shelf life and risk">
      <div className="hero-main">
        <p className="eyebrow">Remaining shelf life</p>
        <div className="hero-number" aria-live="polite">
          <span>{shelf.toFixed(1)}</span>
          <small>h</small>
        </div>
        <p className="hero-sub">{daysAndHours(shelf)} at current conditions</p>
      </div>

      <div className="hero-side">
        <p className="eyebrow">Spoilage risk</p>
        <div className="risk-badge">{RISK_COPY[level].label}</div>
        <p className="hero-note">{RISK_COPY[level].note}</p>
        <dl className="facts">
          <div>
            <dt>Cover</dt>
            <dd>{margin}×</dd>
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

      <LifeTrack shelf={shelf} transit={transit} reference={shipment.profile.referenceShelfLifeHours} />
    </section>
  );
}

function LifeTrack({ shelf, transit, reference }: { shelf: number; transit: number; reference: number }) {
  const shelfPct = clamp((shelf / reference) * 100);
  const transitPct = clamp((transit / reference) * 100);
  const beforeArrival = shelf < transit;
  return (
    <div className="life-track" aria-label="Shelf life against remaining transit">
      <div className="track-labels">
        <span>Shelf life {hours(shelf)} h</span>
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
  const { current, shipment } = state;
  const p = shipment.profile;
  const temp = state.telemetry.at(-1)?.temperatureC ?? p.referenceTempC;
  const rh = state.telemetry.at(-1)?.humidityPct ?? p.referenceHumidityPct;
  const shelf = useTween(current.remainingShelfLifeHours);
  const equivalent = useTween(current.equivalentAgeHours);

  const steps = [
    {
      label: 'Ambient temperature',
      value: `${temp.toFixed(1)} °C`,
      detail: `reference ${p.referenceTempC} °C`,
    },
    {
      label: 'Thermal stress',
      value: multiplier(current.thermalMultiplier),
      detail: `Q10 ${p.q10} ^ ((${temp.toFixed(1)} − ${p.referenceTempC}) ÷ 10)`,
    },
    {
      label: 'Humidity effect',
      value: multiplier(current.humidityMultiplier),
      detail: `1 + 0.01 × max(0, ${rh.toFixed(0)} − ${p.referenceHumidityPct})`,
    },
    {
      label: 'Equivalent ageing',
      value: multiplier(current.ageRate),
      detail: 'thermal × humidity: reference hours spent per real hour',
    },
    {
      label: 'Cumulative damage',
      value: `${equivalent.toFixed(1)} h`,
      detail: `of ${p.referenceShelfLifeHours} reference hours (${((equivalent / p.referenceShelfLifeHours) * 100).toFixed(1)}% spent)`,
    },
    {
      label: 'Remaining shelf life',
      value: `${shelf.toFixed(1)} h`,
      detail: `(${p.referenceShelfLifeHours} − ${equivalent.toFixed(1)}) ÷ ${current.ageRate.toFixed(2)}`,
    },
    {
      label: 'Cover vs transit',
      value: `${current.margin >= 99 ? '99+' : current.margin.toFixed(2)}×`,
      detail: `${shelf.toFixed(1)} h shelf ÷ ${hours(current.transitRemainingHours)} h transit left`,
    },
    {
      label: 'Risk level',
      value: RISK_COPY[current.riskLevel].label,
      detail: 'critical < 1.00 · high < 1.25 · moderate < 2.00 · low ≥ 2.00',
    },
  ];

  return (
    <section className="panel chain" aria-labelledby="chain-title">
      <header className="panel-head">
        <h2 id="chain-title">Degradation chain</h2>
        <span className="panel-note">Q10 model · deterministic</span>
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

function Market({ state }: { state: ShipmentState }) {
  const { listing, recommendations, alerts, shipment } = state;
  const discounted = listing.discountPct > 0;
  const latest = recommendations[0];

  return (
    <section className="panel market" aria-labelledby="market-title">
      <header className="panel-head">
        <h2 id="market-title">Marketplace</h2>
        <span className={`status-tag ${discounted ? 'is-liquidation' : ''}`}>
          {discounted ? 'Liquidation listing' : 'Normal price'}
        </span>
      </header>

      <div className="listing">
        <div>
          <p className="eyebrow">{shipment.produce} · {shipment.quantityKg.toLocaleString()} kg</p>
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
          <p className="eyebrow">Liquidation recommendation</p>
          <p className="rec-line">
            Sell by <strong>~{latest.sellByHours} h</strong> at {rupees(latest.liquidationPricePerKg)}/kg
          </p>
          <p className="rec-rationale">{latest.rationale}</p>
        </div>
      ) : (
        <p className="quiet">No liquidation needed. Recommendations appear when risk reaches HIGH.</p>
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
  const reference = state.shipment.profile.referenceTempC;
  const width = 600;
  const height = 180;
  const pad = 24;
  const y = (t: number) => height - pad - (clamp(t, 0, 30) / 30) * (height - pad * 2);
  const x = (i: number) => (points.length <= 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.temperatureC).toFixed(1)}`).join(' ');

  return (
    <section className="panel trace" aria-labelledby="trace-title">
      <header className="panel-head">
        <h2 id="trace-title">Telemetry trace</h2>
        <span className="panel-note">{points.length} readings stored</span>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Temperature readings over time">
        <line
          x1={pad}
          x2={width - pad}
          y1={y(reference)}
          y2={y(reference)}
          className="ref-line"
        />
        <text x={pad} y={y(reference) - 6} className="ref-label">
          reference {reference} °C
        </text>
        {points.length > 0 && <path d={path} className="trace-line" />}
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.temperatureC)} r={4.5} className={p.temperatureC > reference + 4 ? 'dot hot' : 'dot'} />
            <text x={x(i)} y={y(p.temperatureC) - 10} className="dot-label">
              {p.temperatureC.toFixed(0)}°
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
  return err instanceof Error ? err.message : 'Something went wrong.';
}
