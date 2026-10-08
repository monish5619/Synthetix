import { useCallback, useEffect, useState } from 'react';
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
import { Explain } from './components/Explain';
import { Hero } from './components/Hero';
import { Liquidation } from './components/Liquidation';
import { Masthead, SystemFooter } from './components/Masthead';
import { StoryRail } from './components/StoryRail';
import { Timeline } from './components/Timeline';
import { clock } from './format';
import { AlertsPage } from './pages/AlertsPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { TelemetryPage } from './pages/TelemetryPage';
import { useRoute } from './route';

const HEALTH_POLL_MS = 15000;
/** Number of story stages. The reveal lights them in order, one every REVEAL_MS. */
const STAGE_COUNT = 7;
const REVEAL_MS = 420;
/** The shelf-life number holds its old value until the story reaches the risk stages. */
const NUMBER_HOLD_MS = 1000;

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

export function App() {
  const [state, setState] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Stages revealed so far. Infinity means everything is shown, which is the steady state. */
  const [revealed, setRevealed] = useState<number>(Infinity);
  const [playing, setPlaying] = useState(false);
  const route = useRoute();

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
        .then((h) => {
          if (!alive) return;
          setHealth(h);
          setHealthError(false);
        })
        .catch(() => alive && setHealthError(true));
    void check();
    const timer = window.setInterval(check, HEALTH_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Plays the consequence chain one stage at a time, after the backend has confirmed the event.
  useEffect(() => {
    if (!playing) return;
    if (typeof revealed === 'number' && revealed >= STAGE_COUNT) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setRevealed((r) => (r === Infinity ? STAGE_COUNT : r + 1)), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, revealed]);

  /**
   * Primary action. The displayed state changes only after the backend confirms.
   * A failure leaves everything as it was and says so.
   */
  async function runAction(kind: 'spike' | 'normal') {
    if (!state || busy) return;
    setBusy(kind === 'spike' ? 'spike' : 'normal');
    setActionError(null);
    setRun({ kind, phase: 'pending', confirmations: [] });
    try {
      const result = await (kind === 'spike' ? simulateSpike : simulateNormal)(state.shipment.id);
      setState(result.shipment);
      setRun({ kind, phase: 'confirmed', confirmations: confirmationsFor(result) });
      if (kind === 'spike') {
        setRevealed(1);
        setPlaying(true);
      } else {
        setRevealed(Infinity);
        setPlaying(false);
      }
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
    setRevealed(Infinity);
    setPlaying(false);
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
      <Masthead route={route} />

      {route === 'marketplace' && <MarketplacePage />}
      {route === 'telemetry' && <TelemetryPage />}
      {route === 'alerts' && <AlertsPage />}

      {route === 'control' && loading && !state && <Skeleton />}

      {route === 'control' && loadError && !state && (
        <section className="notice-panel" role="alert">
          <p className="eyebrow">Shipment unavailable</p>
          <p>{loadError}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}

      {route === 'control' && state && (
        <>
          <header className="thesis">
            <p className="eyebrow">Cold-chain monitoring · predictive shelf life · automated liquidation</p>
            <p className="thesis-line">
              Produce loses its value in transit before anyone can see it. AgroSense reads the cold chain, predicts the
              shelf life left, and reprices the produce before it spoils.
            </p>
            <p className="shipment-line">
              <span className="code">{state.shipment.code}</span> {state.shipment.produce}
              <span className="muted">
                {' '}
                · {state.shipment.origin} → {state.shipment.destination} · {state.shipment.quantityKg.toLocaleString()} kg
                · updated {clock(state.shipment.updatedAt)}
              </span>
            </p>
          </header>

          <Hero state={state} holdMs={playing ? NUMBER_HOLD_MS : 0} />

          <StoryRail state={state} revealed={revealed} />

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
            <Timeline state={state} />
            <Liquidation state={state} />
            <Explain state={state} />
          </div>
        </>
      )}

      <SystemFooter health={health} healthError={healthError} />
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
