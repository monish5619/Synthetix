import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDatabase, type Db } from '../server/db';
import { EnvError, readEnv } from '../server/env';
import { EngineError } from '../server/errors';
import { assertMarkdownPct, assertPricePerKg, isValidIdempotencyKey } from '../server/guards';
import { getShipmentRow, ingestTelemetry } from '../server/pipeline';
import { seedDemoShipment } from '../server/seed';

const ORIGIN = 'https://ui.example.com';

/* ---------- a helper that runs the app on a random port ---------- */

async function start(db: Db, options: { allowedOrigins?: string[]; demoMode?: boolean } = {}) {
  const app = createApp(db, { allowedOrigins: options.allowedOrigins ?? [], demoMode: options.demoMode ?? true });
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, server };
}

let open: Server[] = [];
afterEach(() => {
  for (const s of open) s.close();
  open = [];
});

async function serve(db: Db, options?: Parameters<typeof start>[1]) {
  const { base, server } = await start(db, options);
  open.push(server);
  return base;
}

/* ---------- environment ---------- */

describe('environment validation', () => {
  it('uses safe defaults when nothing is set', () => {
    const env = readEnv({});
    expect(env).toMatchObject({ nodeEnv: 'development', port: 8787, allowedOrigins: [], demoMode: true });
    expect(env.databasePath).toBe('data/agrosense.db');
  });

  it('turns demo controls off by default in production', () => {
    const prod = { NODE_ENV: 'production', INGEST_API_KEY: 'k'.repeat(40) };
    expect(readEnv(prod).demoMode).toBe(false);
    expect(readEnv({ ...prod, DEMO_MODE: 'true' }).demoMode).toBe(true);
  });

  it.each([
    ['PORT', { PORT: 'abc' }],
    ['PORT', { PORT: '0' }],
    ['PORT', { PORT: '70000' }],
    ['PORT', { PORT: '80.5' }],
    ['NODE_ENV', { NODE_ENV: 'staging' }],
    ['DEMO_MODE', { DEMO_MODE: 'yes' }],
    ['DATABASE_PATH', { DATABASE_PATH: '   ' }],
    ['ALLOWED_ORIGINS', { ALLOWED_ORIGINS: '*' }],
    ['ALLOWED_ORIGINS', { ALLOWED_ORIGINS: 'not a url' }],
    ['ALLOWED_ORIGINS', { ALLOWED_ORIGINS: 'https://ui.example.com/path' }],
    ['ALLOWED_ORIGINS', { ALLOWED_ORIGINS: 'https://user:pass@ui.example.com' }],
  ])('rejects a bad %s value', (_name, env) => {
    expect(() => readEnv(env)).toThrow(EnvError);
  });

  it('never echoes the rejected value in the error message', () => {
    const leak = 'http://leak-marker.example.org';
    try {
      readEnv({ NODE_ENV: 'production', ALLOWED_ORIGINS: leak });
      throw new Error('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).not.toContain('leak-marker');
    }
  });

  it('requires https origins in production but accepts a list of exact origins', () => {
    const prod = { NODE_ENV: 'production', INGEST_API_KEY: 'k'.repeat(40) };
    expect(() => readEnv({ ...prod, ALLOWED_ORIGINS: 'http://ui.example.com' })).toThrow(EnvError);
    expect(readEnv({ ...prod, ALLOWED_ORIGINS: `${ORIGIN}, https://other.example.com` }).allowedOrigins).toEqual([
      ORIGIN,
      'https://other.example.com',
    ]);
  });
});

/* ---------- input guards for price, markdown, and idempotency keys ---------- */

describe('input guards', () => {
  it.each([NaN, Infinity, -Infinity, 0, -5, 100_001, '100' as unknown as number])('rejects price %s', (value) => {
    expect(() => assertPricePerKg(value)).toThrow();
  });

  it('accepts a sensible price', () => {
    expect(assertPricePerKg(100)).toBe(100);
  });

  it.each([NaN, Infinity, -1, 61, 1.5, '35' as unknown as number])('rejects markdown %s', (value) => {
    expect(() => assertMarkdownPct(value)).toThrow();
  });

  it('accepts whole-number markdowns from 0 to 60', () => {
    expect(assertMarkdownPct(0)).toBe(0);
    expect(assertMarkdownPct(35)).toBe(35);
    expect(assertMarkdownPct(60)).toBe(60);
  });

  it('accepts only well-formed idempotency keys', () => {
    expect(isValidIdempotencyKey('abcd-1234_xyz')).toBe(true);
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('has spaces in it')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(129))).toBe(false);
  });
});

/* ---------- CORS and security headers ---------- */

describe('CORS and headers', () => {
  it('echoes only an exact configured origin, and never a wildcard', async () => {
    const db = openDatabase(':memory:');
    seedDemoShipment(db);
    const base = await serve(db, { allowedOrigins: [ORIGIN] });

    const allowed = await fetch(`${base}/api/health`, { headers: { Origin: ORIGIN } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(allowed.headers.get('vary')).toContain('Origin');
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();

    const other = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    db.close();
  });

  it('answers preflight for allowed origins and gives unlisted origins nothing', async () => {
    const db = openDatabase(':memory:');
    seedDemoShipment(db);
    const base = await serve(db, { allowedOrigins: [ORIGIN] });

    const ok = await fetch(`${base}/api/telemetry`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    expect(ok.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');

    const denied = await fetch(`${base}/api/telemetry`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(denied.status).toBe(204);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    db.close();
  });

  it('sends security headers and no-store on every API response', async () => {
    const db = openDatabase(':memory:');
    seedDemoShipment(db);
    const base = await serve(db);
    const res = await fetch(`${base}/api/shipments`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-powered-by')).toBeNull();
    db.close();
  });
});

/* ---------- idempotency: a duplicate event is recorded once ---------- */

describe('duplicate events', () => {
  it('a retry with the same key and body writes one event and replays the response', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db);
    const body = JSON.stringify({ shipmentId, temperature: 22, humidity: 80, transitDuration: 2 });
    const headers = { 'content-type': 'application/json', 'Idempotency-Key': 'retry-key-0001' };

    const first = await fetch(`${base}/api/telemetry`, { method: 'POST', headers, body });
    const second = await fetch(`${base}/api/telemetry`, { method: 'POST', headers, body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect((await first.json()).event.id).toBe((await second.json()).event.id);

    const count = db.prepare('SELECT COUNT(*) AS n FROM telemetry_events WHERE shipment_id = ?').get(shipmentId) as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });

  it('refuses a reused key with a different body, and writes nothing for it', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db);
    const headers = { 'content-type': 'application/json', 'Idempotency-Key': 'conflict-key-0002' };
    await fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ shipmentId, temperature: 4, humidity: 60, transitDuration: 1 }),
    });
    const res = await fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ shipmentId, temperature: 30, humidity: 85, transitDuration: 6 }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    const count = db.prepare('SELECT COUNT(*) AS n FROM telemetry_events WHERE shipment_id = ?').get(shipmentId) as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });

  it('rejects a malformed idempotency key before any work happens', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db);
    const res = await fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'no' },
      body: JSON.stringify({ shipmentId, temperature: 4, humidity: 60, transitDuration: 1 }),
    });
    expect(res.status).toBe(400);
    db.close();
  });
});

/* ---------- demo controls ---------- */

describe('demo controls', () => {
  it('are refused when demo mode is off, while real telemetry still works', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const base = await serve(db, { demoMode: false });

    const spike = await fetch(`${base}/api/shipments/${shipmentId}/simulate-spike`, { method: 'POST' });
    expect(spike.status).toBe(403);
    expect((await spike.json()).error.code).toBe('DEMO_DISABLED');

    const reset = await fetch(`${base}/api/shipments/${shipmentId}/reset`, { method: 'POST' });
    expect(reset.status).toBe(403);

    const real = await fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId, temperature: 4, humidity: 60, transitDuration: 1 }),
    });
    expect(real.status).toBe(201);
    db.close();
  });
});

/* ---------- error handling: the client sees codes, never internals ---------- */

describe('error handling', () => {
  it('reports an unavailable database as 503 with no internal detail', async () => {
    const db = openDatabase(':memory:');
    seedDemoShipment(db);
    const base = await serve(db);
    db.close();

    const res = await fetch(`${base}/api/shipments`);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('DATABASE_UNAVAILABLE');
    expect(text).not.toMatch(/not open|ERR_|SQLITE|\.db|stack|at /i);
  });

  it('reports an unexpected server error as a generic 500', async () => {
    const real = openDatabase(':memory:');
    seedDemoShipment(real);
    const broken = {
      prepare: () => {
        throw new Error('internal detail: /secret/path/agro.db SELECT password_hash');
      },
      exec: real.exec.bind(real),
    } as unknown as Db;
    const base = await serve(broken);

    const res = await fetch(`${base}/api/shipments`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('INTERNAL_ERROR');
    expect(text).not.toMatch(/secret|password|SELECT|agro\.db|internal detail|stack/i);
    real.close();
  });

  it('a failed model run rolls back completely and writes nothing', async () => {
    const db = openDatabase(':memory:');
    const shipmentId = seedDemoShipment(db);
    const before = getShipmentRow(db, shipmentId).cumulative_equivalent_age_hours;

    // A negative exposure is refused by the model. The validator would catch it earlier, so
    // this simulates a failure deep in the pipeline, after the event row has been written.
    expect(() =>
      ingestTelemetry(db, { shipmentId, temperature: 22, humidity: 80, transitDuration: -1 }),
    ).toThrow(EngineError);

    const events = db.prepare('SELECT COUNT(*) AS n FROM telemetry_events WHERE shipment_id = ?').get(shipmentId) as { n: number };
    const snapshots = db.prepare('SELECT COUNT(*) AS n FROM shelf_life_snapshots WHERE shipment_id = ?').get(shipmentId) as { n: number };
    expect(events.n).toBe(0);
    expect(snapshots.n).toBe(1); // the baseline only
    expect(getShipmentRow(db, shipmentId).cumulative_equivalent_age_hours).toBe(before);
    db.close();
  });

  it('returns 404 for a missing shipment and 400 for a malformed request, without detail', async () => {
    const db = openDatabase(':memory:');
    seedDemoShipment(db);
    const base = await serve(db);
    const missing = await fetch(`${base}/api/shipments/00000000-0000-4000-8000-000000000000`);
    expect(missing.status).toBe(404);
    const malformed = await fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"shipmentId":',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toMatch(/SyntaxError|at |JSON\.parse/);
    db.close();
  });
});
