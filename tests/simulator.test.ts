import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDatabase, type Db } from '../server/db';
import { FLEET, seedFleet } from '../server/fleet';
import { evaluateExposure } from '../server/model';
import { listShipments } from '../server/pipeline';
import { seedDemoShipment } from '../server/seed';
import { AMBIENT_SPIKE } from '../server/simulator';

let db: Db;
let server: Server;
let base: string;
let id: string;

const boot = async (demoMode: boolean) => {
  const database = openDatabase(':memory:');
  const shipmentId = seedDemoShipment(database);
  const s = createApp(database, { allowedOrigins: [], demoMode }).listen(0);
  await new Promise<void>((resolve) => s.once('listening', () => resolve()));
  return { database, shipmentId, s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
};

beforeAll(async () => {
  const b = await boot(true);
  ({ database: db, shipmentId: id, s: server, url: base } = b);
});
afterAll(() => {
  server.close();
  db.close();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}, url = base) =>
  fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const detail = async () => (await (await fetch(`${base}/api/shipments/${id}`)).json()) as Awaited<ReturnType<typeof import('../server/pipeline').getShipmentDetail>>;
const reset = () => post(`/api/shipments/${id}/reset`, {});
const counts = () => ({
  telemetry: (db.prepare('SELECT COUNT(*) n FROM telemetry_events').get() as { n: number }).n,
  snapshots: (db.prepare('SELECT COUNT(*) n FROM shelf_life_snapshots').get() as { n: number }).n,
  audit: (db.prepare('SELECT COUNT(*) n FROM audit_logs').get() as { n: number }).n,
  recommendations: (db.prepare('SELECT COUNT(*) n FROM liquidation_recommendations').get() as { n: number }).n,
  alerts: (db.prepare('SELECT COUNT(*) n FROM spoilage_alerts').get() as { n: number }).n,
  shipment: JSON.stringify(db.prepare('SELECT * FROM shipments WHERE id = ?').get(id)),
  listing: JSON.stringify(db.prepare('SELECT * FROM marketplace_listings WHERE shipment_id = ?').get(id)),
});
const spike = { temperature: 30, humidity: 85, transitDuration: 6.3 };

describe('preview', () => {
  it('shows what a reading would do, from the real model', async () => {
    await reset();
    const res = await post(`/api/shipments/${id}/preview`, spike);
    expect(res.status).toBe(200);
    const p = await res.json();
    const direct = evaluateExposure({ baselineShelfLifeHours: 120, cumulativeBefore: 0, exposure: { temperatureC: 30, humidityPct: 85, exposureHours: 6.3 } });
    expect(p.model.temperatureStress).toBeCloseTo(direct.temperatureStress, 10);
    expect(p.model.humidityFactor).toBeCloseTo(direct.humidityFactor, 10);
    expect(p.model.equivalentAgeIncrement).toBeCloseTo(direct.equivalentAgeIncrement, 10);
    expect(p.after.remainingHours).toBeCloseTo(direct.remainingHours, 10);
    expect(p.after.riskLevel).toBe('CRITICAL');
    expect(p.before).toMatchObject({ riskLevel: 'NORMAL', markdownPct: 0 });
    expect(p.before.remainingHours).toBeCloseTo(120, 8);
    expect(p.liquidation).toMatchObject({ wouldReprice: true, markdownPct: 35, recommendedPricePerKg: 65 });
  });

  it('writes NOTHING: no event, snapshot, audit row, recommendation, alert, listing or shipment change', async () => {
    await reset();
    const before = counts();
    for (let i = 0; i < 3; i++) {
      const res = await post(`/api/shipments/${id}/preview`, spike);
      expect(res.status).toBe(200);
    }
    expect(counts()).toEqual(before);
    expect((await detail()).current.remainingHours).toBeCloseTo(120, 8);
  });

  it('gives the same answer every time (it is a pure calculation)', async () => {
    const a = await (await post(`/api/shipments/${id}/preview`, spike)).json();
    const b = await (await post(`/api/shipments/${id}/preview`, spike)).json();
    expect(a).toEqual(b);
  });

  it('reports no repricing for a normal reading', async () => {
    await reset();
    const p = await (await post(`/api/shipments/${id}/preview`, { temperature: 4, humidity: 60, transitDuration: 2 })).json();
    expect(p.after.riskLevel).toBe('NORMAL');
    expect(p.liquidation.wouldReprice).toBe(false);
    expect(p.model.temperatureStress).toBeCloseTo(1, 10);
  });

  const invalidReadings: Array<[unknown, string]> = [
    [{ temperature: 99, humidity: 60, transitDuration: 2 }, 'out-of-range temperature'],
    [{ temperature: 4, humidity: 150, transitDuration: 2 }, 'out-of-range humidity'],
    [{ temperature: 4, humidity: 60, transitDuration: -1 }, 'negative duration'],
    [{ temperature: 4, humidity: 60 }, 'missing field'],
    [{ temperature: 'hot', humidity: 60, transitDuration: 2 }, 'non-number'],
    [{ temperature: 4, humidity: 60, transitDuration: 2, extra: 1 }, 'unknown field'],
  ];
  it.each(invalidReadings)('rejects %j (%s) with a 400 and writes nothing', async (body) => {
    const before = counts();
    const res = await post(`/api/shipments/${id}/preview`, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(counts()).toEqual(before);
  });

  it('404s for a shipment that does not exist', async () => {
    const res = await post('/api/shipments/00000000-0000-4000-8000-000000000000/preview', spike);
    expect(res.status).toBe(404);
  });
});

describe('commit (the real pipeline)', () => {
  it('preview and commit agree: what was previewed is what happens', async () => {
    await reset();
    const p = await (await post(`/api/shipments/${id}/preview`, spike)).json();
    const res = await post(`/api/shipments/${id}/simulate`, spike);
    expect(res.status).toBe(201);
    const { shipment } = await res.json();
    expect(shipment.current.remainingHours).toBeCloseTo(p.after.remainingHours, 10);
    expect(shipment.current.riskLevel).toBe(p.after.riskLevel);
    expect(shipment.listing.currentPricePerKg).toBe(p.liquidation.recommendedPricePerKg);
    expect(shipment.listing.discountPct).toBe(p.liquidation.markdownPct);
  });

  it('the mandatory demo path: reset → 120 h → spike → ≈18 h, CRITICAL, automatic markdown and alert', async () => {
    const r = await (await reset()).json();
    expect(r.current.remainingHours).toBeCloseTo(120, 8);
    expect(r.current.riskLevel).toBe('NORMAL');

    const { shipment: s } = await (await post(`/api/shipments/${id}/simulate`, AMBIENT_SPIKE)).json();
    expect(s.current.remainingHours).toBeCloseTo(17.65, 1);
    expect(s.current.riskLevel).toBe('CRITICAL');
    expect(s.listing).toMatchObject({ discountPct: 35, currentPricePerKg: 65 });
    expect(s.recommendations).toHaveLength(1);
    expect(s.alerts).toHaveLength(1);
    expect(s.telemetry).toHaveLength(1);
  });

  it('is identical to the scripted spike: same reading, same result', async () => {
    await reset();
    const scripted = (await (await post(`/api/shipments/${id}/simulate-spike`, {})).json()).shipment;
    await reset();
    const custom = (await (await post(`/api/shipments/${id}/simulate`, spike)).json()).shipment;
    expect(custom.current.remainingHours).toBeCloseTo(scripted.current.remainingHours, 10);
    expect(custom.listing.currentPricePerKg).toBe(scripted.listing.currentPricePerKg);
  });

  it('lets the path decide the shipment: a shipmentId in the body cannot redirect the write', async () => {
    await reset();
    const before = counts();
    const res = await post(`/api/shipments/${id}/simulate`, { ...spike, shipmentId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(201);
    expect(counts().telemetry).toBe(before.telemetry + 1);
    expect((await detail()).telemetry).toHaveLength(1);
  });

  it('rejects an invalid reading without writing anything', async () => {
    await reset();
    const before = counts();
    const res = await post(`/api/shipments/${id}/simulate`, { temperature: 4, humidity: 60, transitDuration: 999 });
    expect(res.status).toBe(400);
    expect(counts()).toEqual(before);
  });

  it('is idempotent with an Idempotency-Key: a retry writes nothing new', async () => {
    await reset();
    const key = { 'Idempotency-Key': 'sim-retry-0001' };
    const a = await post(`/api/shipments/${id}/simulate`, spike, key);
    const b = await post(`/api/shipments/${id}/simulate`, spike, key);
    expect(a.status).toBe(201);
    expect(b.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await detail()).telemetry).toHaveLength(1);
  });
});

describe('demo mode off', () => {
  it('disables both simulator routes', async () => {
    const b = await boot(false);
    try {
      for (const path of ['preview', 'simulate']) {
        const res = await post(`/api/shipments/${b.shipmentId}/${path}`, spike, {}, b.url);
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe('DEMO_DISABLED');
      }
    } finally {
      b.s.close();
      b.database.close();
    }
  });
});

describe('live stream (SSE)', () => {
  it('announces a committed reading to a connected client, and carries no readings', async () => {
    const abort = new AbortController();
    const res = await fetch(`${base}/api/stream`, { signal: abort.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const until = async (needle: string) => {
      const deadline = Date.now() + 4000;
      while (!text.includes(needle) && Date.now() < deadline) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 1500)),
        ]);
        if (value) text += decoder.decode(value);
        if (done) break;
      }
    };
    await until(': connected');
    await reset();
    await post(`/api/shipments/${id}/simulate`, spike);
    await until('"kind":"telemetry"');
    abort.abort();
    expect(text).toContain('event: change');
    expect(text).toContain('"kind":"reset"');
    expect(text).toContain(`"shipmentId":"${id}"`);
    expect(text).not.toMatch(/temperature|remainingHours/); // a nudge, not data
  });

  it('stays silent for a reading that fails validation', async () => {
    const abort = new AbortController();
    const res = await fetch(`${base}/api/stream`, { signal: abort.signal });
    const reader = res.body!.getReader();
    await reader.read(); // the connect frame
    await post(`/api/shipments/${id}/simulate`, { temperature: 4, humidity: 60, transitDuration: 999 });
    const got = await Promise.race([reader.read().then(() => 'frame'), new Promise((r) => setTimeout(() => r('quiet'), 600))]);
    abort.abort();
    expect(got).toBe('quiet');
  });
});

describe('demo fleet', () => {
  it('seeds the fleet once, and only once', () => {
    const fresh = openDatabase(':memory:');
    seedDemoShipment(fresh);
    expect(seedFleet(fresh)).toBe(FLEET.length);
    expect(seedFleet(fresh)).toBe(0);
    expect(listShipments(fresh)).toHaveLength(FLEET.length + 1);
    fresh.close();
  });

  it('every fleet figure is what the model computes, not a typed-in number', () => {
    const fresh = openDatabase(':memory:');
    seedDemoShipment(fresh);
    seedFleet(fresh);
    const list = listShipments(fresh);
    for (const spec of FLEET) {
      const s = list.find((x) => x.code === spec.code)!;
      let cumulative = 0;
      for (const r of spec.readings) {
        cumulative = evaluateExposure({
          baselineShelfLifeHours: spec.shelfLifeHours,
          cumulativeBefore: cumulative,
          exposure: { temperatureC: r.temperature, humidityPct: r.humidity, exposureHours: r.transitDuration },
        }).cumulativeEquivalentAge;
      }
      expect(s.remainingHours).toBeCloseTo(Math.max(0, spec.shelfLifeHours - cumulative), 8);
      expect(s.baselineShelfLifeHours).toBe(spec.shelfLifeHours);
    }
    fresh.close();
  });

  it('shows a spread of risk, so the fleet view has something to sort', () => {
    const fresh = openDatabase(':memory:');
    seedDemoShipment(fresh);
    seedFleet(fresh);
    const risks = new Set(listShipments(fresh).map((s) => s.riskLevel));
    expect(risks.size).toBeGreaterThanOrEqual(3);
    fresh.close();
  });

  it('keeps the demo shipment findable by its code, whichever row is first', () => {
    const fresh = openDatabase(':memory:');
    seedFleet(fresh);
    const demoId = seedDemoShipment(fresh); // demo created AFTER the fleet, as after a reset
    const list = listShipments(fresh);
    expect(list[0]!.code).not.toBe('AS-1042');
    expect(list.find((s) => s.code === 'AS-1042')?.id).toBe(demoId);
    fresh.close();
  });
});
