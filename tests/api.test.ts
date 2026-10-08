import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDatabase, type Db } from '../server/db';
import { seedDemoShipment } from '../server/seed';
import { AMBIENT_SPIKE, NORMAL_READING } from '../shared/scenarios';

let db: Db;
let server: Server;
let base: string;
let shipmentId: string;

beforeAll(async () => {
  db = openDatabase(':memory:');
  shipmentId = seedDemoShipment(db);
  server = createApp(db).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('AgroSense API', () => {
  it('starts in the LOW-risk initial state', async () => {
    const state = await (await fetch(`${base}/api/shipments/${shipmentId}`)).json();
    expect(state.current.riskLevel).toBe('LOW');
    expect(state.current.remainingShelfLifeHours).toBeCloseTo(120, 6);
    expect(state.listing.currentPricePerKg).toBe(100);
    expect(state.listing.status).toBe('NORMAL');
    expect(state.alerts).toHaveLength(0);
  });

  it('runs the ambient spike end to end and persists every artefact', async () => {
    const res = await post(`/api/shipments/${shipmentId}/telemetry`, AMBIENT_SPIKE);
    expect(res.status).toBe(201);
    const state = await res.json();

    expect(state.current.riskLevel).toBe('CRITICAL');
    expect(state.current.remainingShelfLifeHours).toBeGreaterThan(17);
    expect(state.current.remainingShelfLifeHours).toBeLessThan(18.5);
    expect(state.listing.discountPct).toBe(34);
    expect(state.listing.currentPricePerKg).toBe(66);
    expect(state.listing.status).toBe('LIQUIDATION');
    expect(state.recommendations).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].severity).toBe('CRITICAL');
    expect(state.telemetry).toHaveLength(1);
    expect(state.audit.map((a: { eventType: string }) => a.eventType)).toEqual(
      expect.arrayContaining([
        'TELEMETRY_RECEIVED',
        'SHELF_LIFE_RECALCULATED',
        'LIQUIDATION_RECOMMENDED',
        'MARKETPLACE_LISTING_UPDATED',
        'SPOILAGE_ALERT_RAISED',
      ]),
    );
  });

  it('keeps discounts from rising back after a normal reading', async () => {
    const res = await post(`/api/shipments/${shipmentId}/telemetry`, NORMAL_READING);
    const state = await res.json();
    expect(state.listing.discountPct).toBe(34);
    expect(state.listing.currentPricePerKg).toBe(66);
    expect(state.alerts).toHaveLength(1); // no duplicate alert without escalation
  });

  it('rejects invalid telemetry without writing anything', async () => {
    const before = await (await fetch(`${base}/api/shipments/${shipmentId}`)).json();
    const bad = await post(`/api/shipments/${shipmentId}/telemetry`, {
      temperatureC: 999,
      humidityPct: 'wet',
      intervalHours: 0,
      source: 'HAND',
    });
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.details.length).toBeGreaterThanOrEqual(4);

    const after = await (await fetch(`${base}/api/shipments/${shipmentId}`)).json();
    expect(after.telemetry).toHaveLength(before.telemetry.length);
  });

  it('handles malformed JSON and unknown shipments safely', async () => {
    const malformed = await post(`/api/shipments/${shipmentId}/telemetry`, '{not json');
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toBe('Malformed JSON body.');

    const unknown = await post('/api/shipments/00000000-0000-4000-8000-000000000000/telemetry', AMBIENT_SPIKE);
    expect(unknown.status).toBe(404);

    const badId = await fetch(`${base}/api/shipments/not-a-uuid`);
    expect(badId.status).toBe(400);
  });

  it('reset restores the initial state under the same id', async () => {
    const res = await post(`/api/shipments/${shipmentId}/reset`, {});
    const state = await res.json();
    expect(state.shipment.id).toBe(shipmentId);
    expect(state.current.riskLevel).toBe('LOW');
    expect(state.listing.currentPricePerKg).toBe(100);
    expect(state.alerts).toHaveLength(0);
    expect(state.telemetry).toHaveLength(0);
  });
});
