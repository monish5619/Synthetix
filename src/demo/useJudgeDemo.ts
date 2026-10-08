import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShipmentDetail } from '../../server/pipeline';
import { claimListing, fetchAlerts, fetchMarketplace, previewReading, resetShipment, simulateSpike } from '../api';
import { DEMO_STEPS, DemoError, runJudgeDemo, type DemoDeps, type StepId, type StepUpdate } from './judgeDemo';

export interface StepView {
  id: StepId;
  title: string;
  status: 'waiting' | 'active' | 'done' | 'failed';
  headline?: string;
  facts: string[];
}

export type DemoPhase = 'idle' | 'running' | 'success' | 'failed';

const initialSteps = (): StepView[] => DEMO_STEPS.map((s) => ({ ...s, status: 'waiting', facts: [] }));

const liveDeps: DemoDeps = {
  reset: resetShipment,
  preview: previewReading,
  spike: simulateSpike,
  marketplace: fetchMarketplace,
  alerts: fetchAlerts,
  claim: (id) => claimListing(id),
  wait: (ms) => new Promise((r) => window.setTimeout(r, ms)),
};

interface Hooks {
  /** Called with each shipment state the server returns, so the Control Tower can show it. */
  onState: (state: ShipmentDetail) => void;
  onReset: () => void;
  onSpikeCommitted: () => void;
}

/** Progress of the judge demo. The steps only advance as server responses arrive. */
export function useJudgeDemo({ onState, onReset, onSpikeCommitted }: Hooks) {
  const [steps, setSteps] = useState<StepView[]>(initialSteps);
  const [phase, setPhase] = useState<DemoPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt.current), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = useCallback(
    async (shipmentId: string, deps: DemoDeps = liveDeps) => {
      setSteps(initialSteps());
      setError(null);
      setPhase('running');
      startedAt.current = Date.now();
      setElapsedMs(0);
      const apply = (u: StepUpdate) => {
        setSteps((list) =>
          list.map((s) => {
            if (s.id === u.id) {
              return { ...s, status: u.status, headline: u.headline ?? s.headline, facts: u.facts ?? s.facts };
            }
            return s;
          }),
        );
        if (u.state) onState(u.state);
        if (u.id === 'reset' && u.status === 'done') onReset();
        if (u.id === 'spike' && u.status === 'done') onSpikeCommitted();
      };
      try {
        await runJudgeDemo(shipmentId, deps, apply);
        setPhase('success');
      } catch (err) {
        const step = err instanceof DemoError ? err.step : null;
        if (step) setSteps((list) => list.map((s) => (s.id === step ? { ...s, status: 'failed' } : s)));
        setError(err instanceof Error ? err.message : 'The demo stopped.');
        setPhase('failed');
      } finally {
        setElapsedMs(Date.now() - startedAt.current);
      }
    },
    [onState, onReset, onSpikeCommitted],
  );

  return { steps, phase, error, elapsedMs, start };
}
