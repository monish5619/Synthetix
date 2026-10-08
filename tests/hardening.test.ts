import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDatabase, type Db } from '../server/db';
import { EnvError, readEnv } from '../server/env';
import { fixedWindowLimiter } from '../server/ratelimit';
import { seedDemoShipment } from '../server/seed';
import { AMBIENT_SPIKE } from '../server/simulator';

const KEY = 'k'.repeat(40);
let servers: Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

async function serve(db: Db, options: Partial<Parameters<typeof createApp>[1]> = {}) {
  const app = createApp(db, { allowedOrigins: [], demoMode: true, ...options });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((r) => server.once('listening', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const readingBody = (shipmentId: string) =>
  JSON.stringify({ shipmentId, temperature: 4, humidity: 60, transitDuration: 1 });

describe('ingest authentication', () => {
  it('production refuses to start without an ingest key', () => {
    expect(() => readEnv({ NODE_ENV: 'production' })).toThrow(EnvError);
  });

  it('a short ingest key is refused', () => {
    expect(() => readEnv({ NODE_ENV: 'development', INGEST_API_KEY: 'short' })).toThrow(EnvError);
  });

  it('with a key configured, external telemetry needs it', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db, { ingestApiKey: KEY });
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/api/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: readingBody(shipmentId) });

    const none = await post({});
    expect(none.status).toBe(401);
    expect((await none.json()).error.code).toBe('UNAUTHORIZED');

    const wrong = await post({ 'X-Ingest-Key': 'x'.repeat(40) });
    expect(wrong.status).toBe(401);
    expect((await wrong.text()).includes(KEY)).toBe(false);

    const right = await post({ 'X-Ingest-Key': KEY });
    expect(right.status).toBe(201);
    db.close();
  });

  it('the demo controls do not need the ingest key', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db, { ingestApiKey: KEY });
    const res = await fetch(`${base}/api/shipments/${shipmentId}/simulate-spike`, { method: 'POST' });
    expect(res.status).toBe(201);
    db.close();
  });
});

describe('write rate limiting', () => {
  it('limits writes per client and leaves reads alone', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db, { rateLimitPerMinute: 3 });
    const post = () =>
      fetch(`${base}/api/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: readingBody(shipmentId) });

    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(201);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await limited.json()).error.code).toBe('RATE_LIMITED');

    const read = await fetch(`${base}/api/shipments`);
    expect(read.status).toBe(200);
    db.close();
  });

  it('the window resets after a minute', () => {
    let t = 0;
    const allow = fixedWindowLimiter(2, 60_000, () => t);
    expect([allow('a'), allow('a'), allow('a')]).toEqual([true, true, false]);
    expect(allow('b')).toBe(true);
    t = 60_000;
    expect(allow('a')).toBe(true);
  });
});

describe('retailer acknowledgement', () => {
  it('acknowledges an alert once, keeps the first time, and writes an audit event', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db);
    await fetch(`${base}/api/shipments/${shipmentId}/simulate-spike`, { method: 'POST' });
    const { alerts } = await (await fetch(`${base}/api/alerts`)).json();
    const id = alerts[0].id as string;
    expect(alerts[0].acknowledgedAt).toBeNull();

    const first = await (await fetch(`${base}/api/alerts/${id}/acknowledge`, { method: 'POST' })).json();
    expect(first.alert.acknowledgedAt).toEqual(expect.any(String));
    const second = await (await fetch(`${base}/api/alerts/${id}/acknowledge`, { method: 'POST' })).json();
    expect(second.alert.acknowledgedAt).toBe(first.alert.acknowledgedAt);

    const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = 'RETAILER_ACKNOWLEDGED'").get() as { n: number };
    expect(audit.n).toBe(1);
    db.close();
  });

  it('rejects malformed and unknown alert ids', async () => {
    const db = openDatabase(':memory:');
    seedDemoShipment(db);
    const base = await serve(db);
    expect((await fetch(`${base}/api/alerts/nope/acknowledge`, { method: 'POST' })).status).toBe(400);
    const missing = await fetch(`${base}/api/alerts/00000000-0000-4000-8000-000000000000/acknowledge`, { method: 'POST' });
    expect(missing.status).toBe(404);
    db.close();
  });
});

// Keep the spike constant referenced so a change to the demo scenario is caught here too.
it('the demo spike is still the 30 °C excursion', () => {
  expect(AMBIENT_SPIKE.temperature).toBe(30);
});
