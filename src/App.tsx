import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { usePathView } from './pathView';
import { FloatingCrate } from './components/FloatingCrate';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShipmentDetail } from '../server/pipeline';
import {
  fetchHealth,
  fetchShipment,
  fetchShipments,
  resetShipment,
  simulateNormal,
  simulateReading,
  simulateSpike,
  type HealthReport,
  type Reading,
  type ScenarioResult,
} from './api';
import { ActionBar, type ActionKind, type RunStatus } from './components/ActionBar';
import { Explain } from './components/Explain';
import { WhyDrop } from './components/WhyDrop';
import { JudgeDemo } from './components/JudgeDemo';
import { useJudgeDemo } from './demo/useJudgeDemo';
import { SimulatorPanel } from './components/SimulatorPanel';
import { useChangeStream } from './live';
import { FleetPage } from './pages/FleetPage';
import { pickShipment, useSelectedShipmentId } from './selection';
import { Hero } from './components/Hero';
import { Liquidation } from './components/Liquidation';
import { SystemFooter } from './components/SystemFooter';
import { StoryRail } from './components/StoryRail';
import { Timeline } from './components/Timeline';
import { hours } from './format';
import { AlertsPage } from './pages/AlertsPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { TelemetryPage } from './pages/TelemetryPage';
import { useRoute } from './route';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { StatusPage } from './pages/StatusPage';
import { Shell } from './shell/Shell';
import { HEARTBEAT_MS } from './shell/status';
import { addToast, removeToast, type Toast, type ToastKind } from './toasts';
import { ToastRegion } from './ui/Toast';
import { ErrorState, Skeleton } from './ui/layout';

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

function confirmationsFor(result: Pick<ScenarioResult, 'event' | 'shipment'>): string[] {
  const { event, shipment } = result;
  const persisted = shipment.telemetry.some((t) => t.id === event.id);
  const types = new Set(shipment.audit.filter((a) => a.createdAt === event.recordedAt).map((a) => a.eventType));
  const items = persisted ? ['Telemetry persisted'] : [];
  for (const c of CONFIRMATIONS) if (types.has(c.eventType)) items.push(c.label);
  return items;
}

export function App() {
  const view = usePathView();
  const [state, setState] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  /** When the server last answered, as a timestamp. It feeds the "Live • synced 2s ago" pill, so it only ever moves on a real response. */
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const notify = useCallback((kind: ToastKind, text: string) => {
    setToasts((list) => addToast(list, { id: ++toastId.current, kind, text }));
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((list) => removeToast(list, id)), []);
  /** Stages revealed so far. Infinity means everything is shown, which is the steady state. */
  const [revealed, setRevealed] = useState<number>(Infinity);
  const [playing, setPlaying] = useState(false);
  const route = useRoute();
  const selectedId = useSelectedShipmentId();
  const lastReading = useRef<Reading | null>(null);

  const demo = useJudgeDemo({
    onState: useCallback((next: ShipmentDetail) => {
      setState(next);
      setLastSyncedAt(Date.now());
    }, []),
    onReset: useCallback(() => {
      setRun(null);
      setRevealed(Infinity);
      setPlaying(false);
    }, []),
    onSpikeCommitted: useCallback(() => {
      setRevealed(1);
      setPlaying(true);
    }, []),
  });

  async function runDemo() {
    if (!state || busy) return;
    setBusy('demo');
    try {
      await demo.start(state.shipment.id);
    } finally {
      setBusy(null);
      void fetchHealth().then(setHealth).catch(() => setHealthError(true));
    }
  }

  /** Loads the first persisted shipment. Nothing about it is hard-coded in the UI. */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchShipments();
      if (list.length === 0) throw new Error('No shipments are persisted on the server.');
      const chosen = pickShipment(list, selectedId);
      if (!chosen) throw new Error('No shipments are persisted on the server.');
      setState(await fetchShipment(chosen.id));
      setLastSyncedAt(Date.now());
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

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
          setLastSyncedAt(Date.now());
        })
        .catch(() => alive && setHealthError(true));
    void check();
    const timer = window.setInterval(check, HEARTBEAT_MS);
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
    setRun({ kind, phase: 'pending', confirmations: [] });
    try {
      const result = await (kind === 'spike' ? simulateSpike : simulateNormal)(state.shipment.id);
      setState(result.shipment);
      setLastSyncedAt(Date.now());
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

  /**
   * Commit from the simulator: the reading goes through the same validation and the same
   * telemetry pipeline as everything else, and the screen changes only once the server confirms.
   */
  async function commitReading(reading: Reading) {
    if (!state || busy) return;
    lastReading.current = reading;
    setBusy('custom');
    setRun({ kind: 'custom', phase: 'pending', confirmations: [] });
    try {
      const result = await simulateReading(state.shipment.id, reading);
      setState(result.shipment);
      setLastSyncedAt(Date.now());
      setRun({ kind: 'custom', phase: 'confirmed', confirmations: confirmationsFor(result) });
      setRevealed(1);
      setPlaying(true);
      void fetchHealth().then(setHealth).catch(() => setHealthError(true));
    } catch (err) {
      setRun({ kind: 'custom', phase: 'failed', confirmations: [], message: messageOf(err) });
      throw err;
    } finally {
      setBusy(null);
    }
  }

  function retry() {
    if (!run) return;
    if (run.kind === 'custom') {
      if (lastReading.current) void commitReading(lastReading.current).catch(() => undefined);
    } else {
      void runAction(run.kind);
    }
  }

  // Live updates: the server nudges after every successful write, and we refetch the real state.
  useChangeStream((change) => {
    if (!state || busy !== null || change.shipmentId !== state.shipment.id) return;
    void fetchShipment(state.shipment.id)
      .then((next) => {
        setState(next);
        setLastSyncedAt(Date.now());
      })
      .catch(() => undefined);
  });

  async function reset() {
    if (!state || busy) return;
    setBusy('reset');
    setRun(null);
    setRevealed(Infinity);
    setPlaying(false);
    try {
      // The real reset: the server restores the demo shipment, and the screen shows what it returns.
      const next = await resetShipment(state.shipment.id);
      setState(next);
      setLastSyncedAt(Date.now());
      notify('success', `Demo reset · shelf life is back to ${hours(next.current.remainingHours)} h`);
    } catch (err) {
      notify('error', `Reset failed · ${messageOf(err)} Nothing was changed.`);
    } finally {
      setBusy(null);
    }
  }

  // Public pages sit outside the dashboard shell. Hooks above are all called first, so the order is stable.
  if (view === 'home') return <HomePage />;
  if (view === 'login') return <LoginPage />;

  return (
    <Shell
      route={route}
      sync={{ lastSyncedAt, failed: healthError, health }}
      footer={<SystemFooter health={health} healthError={healthError} />}
    >
      {route === 'marketplace' && <MarketplacePage />}
      {route === 'telemetry' && <TelemetryPage />}
      {route === 'alerts' && <AlertsPage />}
      {route === 'status' && <StatusPage health={health} failed={healthError} />}
      {route === 'fleet' && <FleetPage />}
      {(route === 'impact' || route === 'explainability' || route === 'admin') && (
        <ComingSoonPage route={route} />
      )}

      {route === 'control' && loading && !state && <ControlTowerSkeleton />}

      {route === 'control' && loadError && !state && (
        <ErrorState title="We can't load the control tower" message={`${loadError} Check that the server is running, then try again.`} onRetry={() => void load()} />
      )}

      {route === 'control' && state && (
        <>
          <header className="ct-head">
            <div className="ct-head-copy">
              <h1 className="ct-tagline">Predict shelf life. Sell before it spoils.</h1>
            <p className="ct-meta">
              <span className="code">{state.shipment.code}</span> {state.shipment.produce}
              <span className="muted">
                {' '}
                · {state.shipment.origin} → {state.shipment.destination} · {state.shipment.quantityKg.toLocaleString()} kg
              </span>
            </p>
            </div>
            <FloatingCrate />
          </header>

          <JudgeDemo steps={demo.steps} phase={demo.phase} error={demo.error} elapsedMs={demo.elapsedMs} disabled={busy !== null} onRun={() => void runDemo()} />

          <Hero state={state} holdMs={playing ? NUMBER_HOLD_MS : 0} />

          <StoryRail state={state} revealed={revealed} />

          <ActionBar
            busy={busy}
            run={run}
            onSpike={() => runAction('spike')}
            onNormal={() => runAction('normal')}
            onReset={reset}
            onRetry={retry}
          />

          <SimulatorPanel shipmentId={state.shipment.id} disabled={busy !== null} onCommit={commitReading} />

          <WhyDrop state={state} />

          <div className="board">
            <Timeline state={state} />
            <Liquidation state={state} />
            <Explain state={state} />
          </div>
        </>
      )}

      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </Shell>
  );
}

function ControlTowerSkeleton() {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label="Loading the control tower">
      <Skeleton height={44} width="min(520px, 80%)" />
      <div className="sk-hero-row">
        <Skeleton height={300} width={300} />
        <Skeleton height={300} />
      </div>
      <Skeleton height={130} />
      <Skeleton height={96} />
      <Skeleton height={380} />
    </div>
  );
}

function messageOf(err: unknown): string {
  // A TypeError from fetch means the request never reached the server.
  if (err instanceof TypeError) return 'Could not reach the AgroSense server.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}
