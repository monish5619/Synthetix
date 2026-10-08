import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JudgeDemo, clockText } from '../src/components/JudgeDemo';
import { DEMO_STEPS, DemoError, runJudgeDemo, type DemoDeps, type StepUpdate } from '../src/demo/judgeDemo';
import type { StepView } from '../src/demo/useJudgeDemo';
import { createApp } from '../server/app';
import { openDatabase } from '../server/db';
import { getShipmentDetail, ingestTelemetry } from '../server/pipeline';
import { previewTelemetry } from '../server/preview';
import { resetDemoShipment, seedDemoShipment } from '../server/seed';
import { AMBIENT_SPIKE } from '../server/simulator';
import { validateTelemetry } from '../server/validation';
import { claimListing, listAlerts, listMarketplace } from '../server/views';

/** Dependencies backed by a real in-memory database and the real server functions. Results are never mocked. */
function realDeps() {
  const db = openDatabase(':memory:');
  const id = seedDemoShipment(db);
  const valid = (sid: string, reading: { temperature: number; humidity: number; transitDuration: number }) => {
    const v = validateTelemetry({ shipmentId: sid, ...reading });
    if (!v.ok) throw new Error('invalid reading');
    return v.value;
  };
  const deps: DemoDeps = {
    reset: async () => getShipmentDetail(db, resetDemoShipment(db)),
    preview: async (sid, reading) => previewTelemetry(db, valid(sid, reading)),
    spike: async (sid) => {
      const event = ingestTelemetry(db, valid(sid, AMBIENT_SPIKE));
      return { scenario: 'ambient-spike', readings: AMBIENT_SPIKE, event, shipment: getShipmentDetail(db, sid) } as never;
    },
    marketplace: async () => listMarketplace(db),
    alerts: async () => listAlerts(db) as never,
    claim: async (lid) => claimListing(db, lid) as never,
    wait: async () => {},
  };
  return { db, id, deps };
}

describe('judge demo runner (real pipeline)', () => {
  it('plays the seven steps in order and ends on the real stored state', async () => {
    const { db, id, deps } = realDeps();
    const updates: StepUpdate[] = [];
    await runJudgeDemo(id, deps, (u) => updates.push(u));

    expect([...new Set(updates.map((u) => u.id))]).toEqual(DEMO_STEPS.map((s) => s.id));
    const head = (step: string) => updates.filter((u) => u.id === step && u.status === 'done').at(-1)!.headline;
    expect(head('normal')).toBe('120.0 h · NORMAL');
    expect(head('collapse')).toMatch(/^17\.\d h · CRITICAL$/);
    expect(head('markdown')).toBe('35% off · ₹65/kg');
    expect(head('alert')).toContain('₹65');
    expect(head('rescue')).toBe('RESCUED');

    const l = listMarketplace(db).find((x) => x.shipmentId === id)!;
    expect(l).toMatchObject({ discountPct: 35, currentPricePerKg: 65, availableKg: 0, riskLevel: 'CRITICAL' });
    expect(listAlerts(db).filter((a) => a.shipmentId === id)).toHaveLength(1);
  });

  it('every step is marked done only after it was active', async () => {
    const { id, deps } = realDeps();
    const seen: string[] = [];
    await runJudgeDemo(id, deps, (u) => seen.push(`${u.id}:${u.status}`));
    for (const s of DEMO_STEPS) expect(seen.indexOf(`${s.id}:done`)).toBeGreaterThan(seen.indexOf(`${s.id}:active`));
  });

  it('the preview does not write: the spike is the only telemetry write', async () => {
    const { db, id, deps } = realDeps();
    const rows = () => (db.prepare('SELECT COUNT(*) n FROM telemetry_events').get() as { n: number }).n;
    const counts: number[] = [];
    await runJudgeDemo(id, deps, () => {
      counts.push(rows());
    });
    expect(rows()).toBe(1);
    expect(Math.max(...counts)).toBe(1);
  });

  it('can be run twice: the second run starts from a real reset', async () => {
    const { id, deps } = realDeps();
    await runJudgeDemo(id, deps, () => {});
    const updates: StepUpdate[] = [];
    await runJudgeDemo(id, deps, (u) => updates.push(u));
    expect(updates.find((u) => u.id === 'normal' && u.status === 'done')!.headline).toBe('120.0 h · NORMAL');
    expect(updates.find((u) => u.id === 'rescue' && u.status === 'done')!.headline).toBe('RESCUED');
  });

  it('fails loudly on the right step when the server produced no alert or no listing', async () => {
    const a = realDeps();
    await expect(runJudgeDemo(a.id, { ...a.deps, alerts: async () => [] }, () => {})).rejects.toMatchObject({ step: 'alert' });
    const b = realDeps();
    await expect(runJudgeDemo(b.id, { ...b.deps, marketplace: async () => [] }, () => {})).rejects.toBeInstanceOf(DemoError);
  });

  it('reports a failed server call as a failed step and never reaches success', async () => {
    const { id, deps } = realDeps();
    const seen: string[] = [];
    await expect(
      runJudgeDemo(
        id,
        {
          ...deps,
          spike: async () => {
            throw new Error('boom');
          },
        },
        (u) => seen.push(`${u.id}:${u.status}`),
      ),
    ).rejects.toMatchObject({ step: 'spike', message: 'boom' });
    expect(seen).not.toContain('collapse:done');
    expect(seen).not.toContain('rescue:done');
  });
});

describe('judge demo over HTTP (the routes the browser uses)', () => {
  it('reset, preview, spike, marketplace and claim work in sequence', async () => {
    const db = openDatabase(':memory:');
    const id = seedDemoShipment(db);
    const server = createApp(db, { allowedOrigins: [], demoMode: true }).listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (p: string, b: unknown = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    try {
      expect((await post(`/api/shipments/${id}/reset`)).status).toBe(200);
      expect((await post(`/api/shipments/${id}/preview`, AMBIENT_SPIKE)).status).toBe(200);
      const spike = await (await post(`/api/shipments/${id}/simulate-spike`)).json();
      expect(spike.shipment.current.remainingHours).toBeCloseTo(17.65, 1);
      const { listings } = await (await fetch(`${base}/api/marketplace`)).json();
      const l = listings.find((x: { shipmentId: string }) => x.shipmentId === id);
      expect(l.discountPct).toBe(35);
      expect((await post(`/api/listings/${l.listingId}/claim`)).status).toBe(201);
    } finally {
      server.close();
      db.close();
    }
  });
});

describe('JudgeDemo component', () => {
  const steps = (over: Array<Partial<StepView>> = []): StepView[] => DEMO_STEPS.map((s, i) => ({ ...s, status: 'waiting', facts: [], ...(over[i] ?? {}) }));
  const render = (phase: 'idle' | 'running' | 'success' | 'failed', s = steps(), error: string | null = null) =>
    renderToStaticMarkup(<JudgeDemo steps={s} phase={phase} error={error} elapsedMs={65_000} disabled={false} onRun={() => {}} />);

  it('idle: shows the prominent button and all seven steps, no timer, no success claim', () => {
    const m = render('idle');
    expect(m).toContain('RUN 3-MIN JUDGE DEMO');
    for (const s of DEMO_STEPS) expect(m).toContain(s.title);
    expect(m).not.toContain('role="timer"');
    expect(m).not.toContain('Finished in');
  });
  it('running: disables the button, marks the active step and shows the timer', () => {
    const m = render('running', steps([{ status: 'done' }, { status: 'active' }]));
    expect(m).toContain('Running…');
    expect(m).toContain('disabled=""');
    expect(m).toContain('aria-current="step"');
    expect(m).toContain('role="timer"');
    expect(m).toContain('>1:05<');
  });
  it('done steps show a check and their server headline', () => {
    const m = render('running', steps([{ status: 'done', headline: '120.0 h · NORMAL' }]));
    expect(m).toContain('✓');
    expect(m).toContain('120.0 h · NORMAL');
  });
  it('success: says so, with links to the pages that show the stored result', () => {
    const m = render('success');
    expect(m).toContain('Finished in 1:05');
    expect(m).toContain('href="#/marketplace"');
    expect(m).toContain('RUN AGAIN');
  });
  it('failure: says the demo stopped, with the reason', () => {
    const m = render('failed', steps([{ status: 'failed' }]), 'The server did not create a retailer alert.');
    expect(m).toContain('The demo stopped');
    expect(m).toContain('did not create a retailer alert');
  });
  it('formats the timer as m:ss', () => {
    expect([clockText(0), clockText(59_999), clockText(61_000)]).toEqual(['0:00', '0:59', '1:01']);
  });
});
