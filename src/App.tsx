import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShipmentDetail } from '../server/pipeline';
import {
  fetchHealth,
  fetchShipment,
  fetchShipments,
  resetShipment,
  simulateNormal,
  simulateSpike,
  type HealthReport,
  type ScenarioResult,
} from './api';
import { ActionBar, type ActionKind, type RunStatus } from './components/ActionBar';
import { Activity } from './components/Activity';
import { Explain } from './components/Explain';
import { Hero, type SequenceStep } from './components/Hero';
import { Liquidation } from './components/Liquidation';
import { Masthead } from './components/Masthead';
import { Timeline } from './components/Timeline';
import { clock } from './format';

const SEQUENCE_STEP_MS = 380;
const HEALTH_POLL_MS = 15000;

/** Backend-confirmed records for one run, read from the response. Never inferred. */
const CONFIRMATIONS: Array<{ eventType: string; label: string }> = [
  { eventType: 'SHELF_LIFE_RECALCULATED', label: 'Shelf life recalculated' },
  { eventType: 'RISK_ESCALATED', label: 'Risk escalated' },
  { eventType: 'LIQUIDATION_RECOMMENDED', label: 'Liquidation triggered' },
  { eventType: 'MARKETPLACE_UPDATED', label: 'Marketplace updated' },
  { eventType: 'RETAILER_ALERT_GENERATED', label: 'Retailer alert generated' },
];

function confirmationsFor(result: ScenarioResult): string[] {
  const { event, shipment } = result;
  const persisted = shipment.telemetry.some((t) => t.id === event.id);
  const types = new Set(shipment.audit.filter((a) => a.createdAt === event.recordedAt).map((a) => a.eventType));
  const items = persisted ? ['Telemetry persisted'] : [];
  for (const c of CONFIRMATIONS) if (types.has(c.eventType)) items.push(c.label);
  return items;
}

interface Sequence {
  step: SequenceStep;
  result: ScenarioResult;
}

export function App() {
  const [state, setState] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const seenAudit = useRef<Set<string> | null>(null);

  /** Loads the first persisted shipment. Nothing about it is hard-coded in the UI. */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchShipments();
      if (list.length === 0) throw new Error('No shipments are persisted on the server.');
      setState(await fetchShipment(list[0].id));
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Health is checked live, and polled so a server outage shows up.
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetchHealth()
        .then((h) => alive && (setHealth(h), setHealthError(false)))
        .catch(() => alive && setHealthError(true));
    void check();
    const timer = window.setInterval(check, HEALTH_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Highlight audit entries and alerts that arrived with the latest response.
  useEffect(() => {
    if (!state) return;
    const ids = new Set([...state.audit.map((a) => a.id), ...state.alerts.map((a) => a.id)]);
    if (seenAudit.current) {
      const added = [...ids].filter((id) => !seenAudit.current!.has(id));
      if (added.length > 0) setFresh(new Set(added));
    }
    seenAudit.current = ids;
  }, [state]);

  // Advances the spike reveal one backend-confirmed fact at a time.
  useEffect(() => {
    if (!sequence || sequence.step >= 4) return;
    const timer = window.setTimeout(
      () => setSequence((s) => (s && s.step < 4 ? { ...s, step: (s.step + 1) as SequenceStep } : s)),
      SEQUENCE_STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [sequence]);

  /**
   * Primary action. The displayed state changes only after the backend confirms.
   * A failure leaves everything as it was and says so.
   */
  async function runAction(kind: 'spike' | 'normal') {
    if (!state || busy) return;
    setBusy(kind === 'spike' ? 'spike' : 'normal');
    setActionError(null);
    setSequence(null);
    setRun({ kind, phase: 'pending', confirmations: [] });
    try {
      const result = await (kind === 'spike' ? simulateSpike : simulateNormal)(state.shipment.id);
      setState(result.shipment);
      setRun({ kind, phase: 'confirmed', confirmations: confirmationsFor(result) });
      if (kind === 'spike') setSequence({ step: 0, result });
      void fetchHealth().then(setHealth).catch(() => setHealthError(true));
    } catch (err) {
      setRun({ kind, phase: 'failed', confirmations: [], message: messageOf(err) });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!state || busy) return;
    setBusy('reset');
    setRun(null);
    setSequence(null);
    setActionError(null);
    try {
      setState(await resetShipment(state.shipment.id));
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app">
      <Masthead health={health} healthError={healthError} />

      {loading && !state && <Skeleton />}

      {loadError && !state && (
        <section className="notice-panel" role="alert">
          <p className="eyebrow">Shipment unavailable</p>
          <p>{loadError}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}

      {state && (
        <>
          <section className="shipment-strip" aria-label="Active shipment">
            <div className="strip-id">
              <span className="eyebrow">Active shipment</span>
              <span className="strip-code">{state.shipment.code}</span>
            </div>
            <div className="strip-produce">
              <span className="strip-name">{state.shipment.produce}</span>
              <span className="strip-route">
                {state.shipment.origin} → {state.shipment.destination}
              </span>
            </div>
            <dl className="strip-facts">
              <div>
                <dt>Quantity</dt>
                <dd>{state.shipment.quantityKg.toLocaleString()} kg</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="status-pill">{state.shipment.status.replace('_', ' ')}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{clock(state.shipment.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <Hero state={state} sequence={sequence} />

          <ActionBar
            busy={busy}
            run={run}
            loadError={actionError}
            onSpike={() => runAction('spike')}
            onNormal={() => runAction('normal')}
            onReset={reset}
            onRetry={() => run && runAction(run.kind)}
          />

          <div className="board">
            <Liquidation state={state} />
            <Timeline state={state} />
            <Explain state={state} />
            <Activity state={state} fresh={fresh} />
          </div>
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label="Loading the control tower">
      <div className="sk sk-hero" />
      <div className="sk sk-bar" />
      <div className="sk sk-board" />
    </div>
  );
}

function messageOf(err: unknown): string {
  // A TypeError from fetch means the request never reached the server.
  if (err instanceof TypeError) return 'Could not reach the AgroSense server.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}
