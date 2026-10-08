import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDatabase, type Db } from '../server/db';
import { seedDemoShipment } from '../server/seed';
import { AMBIENT_SPIKE, NORMAL_READING } from '../server/simulator';

let db: Db;
let server: Server;
let base: string;
let shipmentId: string;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  db = openDatabase(':memory:');
  shipmentId = seedDemoShipment(db);
  server = createApp(db, { allowedOrigins: [], demoMode: true }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

const telemetry = (body: unknown) => send('POST', '/api/telemetry', body);
const telemetryCount = async () =>
  (await (await send('GET', `/api/shipments/${shipmentId}/telemetry`)).json()).count as number;

/** Expects the standard error shape and no internals leaking into the body. */
async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/at .*\.(ts|js):\d+/); // no stack frames
  expect(text).not.toMatch(/sqlite|SQLITE|\.db|DATABASE_PATH|SELECT|INSERT/i);
  return body;
}

describe('server and database', () => {
  it('reports healthy with a live database', async () => {
    const res = await send('GET', '/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ telemetryApi: 'ONLINE', database: 'CONNECTED', degradationEngine: 'READY', liquidationEngine: 'READY' });
  });

  it('seeds the demo shipment at its initial state', async () => {
    const detail = await (await send('GET', `/api/shipments/${shipmentId}`)).json();
    expect(detail.shipment.code).toBe('AS-1042');
    expect(detail.shipment.produce).toBe('Premium Tomatoes');
    expect(detail.shipment.status).toBe('IN_TRANSIT');
    expect(detail.shipment.originalPricePerKg).toBe(100);
    expect(detail.shipment.baselineShelfLifeHours).toBe(120);
    expect(detail.shipment.idealTemperatureC).toBe(4);
    expect(detail.current.temperature).toBe(4);
    expect(detail.current.humidity).toBe(60);
    expect(detail.current.riskLevel).toBe('NORMAL');
    expect(detail.current.remainingHours).toBeCloseTo(120, 6);
    expect(detail.listing.currentPricePerKg).toBe(100);
    expect(detail.listing.status).toBe('NORMAL');
    expect(detail.alerts).toHaveLength(0);
  });

  it('does not duplicate the demo shipment on re-seed', () => {
    expect(seedDemoShipment(db)).toBe(shipmentId);
    const count = db.prepare('SELECT COUNT(*) AS n FROM shipments').get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('shipment reads', () => {
  it('GET /api/shipments lists persisted shipments with summaries', async () => {
    const body = await (await send('GET', '/api/shipments')).json();
    expect(body.shipments).toHaveLength(1);
    expect(body.shipments[0]).toMatchObject({
      id: shipmentId,
      code: 'AS-1042',
      status: 'IN_TRANSIT',
      currentTemperature: 4,
      currentHumidity: 60,
      riskLevel: 'NORMAL',
      currentPricePerKg: 100,
    });
  });

  it('GET /api/shipments/:id returns 404 for an unknown shipment', async () => {
    await expectError(await send('GET', `/api/shipments/${MISSING_ID}`), 404, 'NOT_FOUND');
  });

  it('rejects a malformed shipment id with 400', async () => {
    await expectError(await send('GET', '/api/shipments/not-a-uuid'), 400, 'INVALID_ID');
  });
});

describe('telemetry ingest', () => {
  it('accepts a valid spike, persists it, and returns the updated shipment', async () => {
    const before = await telemetryCount();
    const res = await telemetry({ shipmentId, ...AMBIENT_SPIKE });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.event).toMatchObject({
      shipmentId,
      temperature: 30,
      humidity: 85,
      transitDuration: 6.3,
    });
    expect(typeof body.event.id).toBe('string');
    expect(body.shipment.current.riskLevel).toBe('CRITICAL');
    expect(body.shipment.current.remainingHours).toBeGreaterThan(17);
    expect(body.shipment.current.remainingHours).toBeLessThan(18.5);
    expect(body.shipment.listing.discountPct).toBe(35);
    expect(body.shipment.listing.currentPricePerKg).toBe(65);
    expect(body.shipment.alerts).toHaveLength(1);
    expect(body.shipment.recommendations).toHaveLength(1);
    expect(body.shipment.audit.map((a: { eventType: string }) => a.eventType)).toEqual(
      expect.arrayContaining([
        'TELEMETRY_RECEIVED',
        'SHELF_LIFE_RECALCULATED',
        'LIQUIDATION_RECOMMENDED',
        'MARKETPLACE_UPDATED',
        'RETAILER_ALERT_GENERATED',
      ]),
    );

    expect(await telemetryCount()).toBe(before + 1);
  });

  it('GET /api/shipments/:id/telemetry returns the persisted event', async () => {
    const body = await (await send('GET', `/api/shipments/${shipmentId}/telemetry`)).json();
    expect(body.shipmentId).toBe(shipmentId);
    const spike = body.events.find((e: { temperature: number }) => e.temperature === 30);
    expect(spike).toMatchObject({ humidity: 85, transitDuration: 6.3 });
    expect(typeof spike.recordedAt).toBe('string');
  });

  it('keeps the discount after a normal reading and does not duplicate the alert', async () => {
    const res = await telemetry({ shipmentId, ...NORMAL_READING });
    const body = await res.json();
    expect(body.shipment.listing.discountPct).toBe(35);
    expect(body.shipment.listing.currentPricePerKg).toBe(65);
    expect(body.shipment.alerts).toHaveLength(1);
  });

  describe('rejects invalid input without writing anything', () => {
    const valid = { shipmentId, temperature: 4, humidity: 60, transitDuration: 1 };

    const cases: Array<[string, unknown]> = [
      ['a body that is not an object', [1, 2]],
      ['a missing shipmentId', { temperature: 4, humidity: 60, transitDuration: 1 }],
      ['a malformed shipmentId', { ...valid, shipmentId: 'abc' }],
      ['a numeric shipmentId', { ...valid, shipmentId: 42 }],
      ['a missing temperature', { shipmentId, humidity: 60, transitDuration: 1 }],
      ['a NaN-like string temperature', { ...valid, temperature: 'NaN' }],
      ['an Infinity temperature (1e999 overflows to Infinity)', { ...valid, temperature: 1e999 }],
      ['a temperature out of range', { ...valid, temperature: 999 }],
      ['impossible humidity above 100', { ...valid, humidity: 101 }],
      ['negative humidity', { ...valid, humidity: -1 }],
      ['a negative transit duration', { ...valid, transitDuration: -2 }],
      ['a transit duration above 24 h', { ...valid, transitDuration: 25 }],
      ['an unknown field', { ...valid, source: 'HAND' }],
    ];

    it.each(cases)('%s', async (_label, body) => {
      const before = await telemetryCount();
      await expectError(await telemetry(body), 400, 'VALIDATION_ERROR');
      expect(await telemetryCount()).toBe(before);
    });

    it('lists each problem in details', async () => {
      const body = await expectError(
        await telemetry({ shipmentId: 'x', temperature: 'hot', humidity: 120, transitDuration: -1 }),
        400,
        'VALIDATION_ERROR',
      );
      expect(body.error.details.length).toBeGreaterThanOrEqual(4);
    });

    it('rejects a null body as malformed (strict JSON object parsing)', async () => {
      await expectError(await telemetry('null'), 400, 'MALFORMED_JSON');
    });

    it('rejects malformed JSON', async () => {
      const res = await telemetry('{"shipmentId": ');
      await expectError(res, 400, 'MALFORMED_JSON');
    });

    it('returns 404 for an unknown shipment id, and stores nothing', async () => {
      const before = await telemetryCount();
      await expectError(await telemetry({ ...valid, shipmentId: MISSING_ID }), 404, 'NOT_FOUND');
      expect(await telemetryCount()).toBe(before);
    });

    it('rejects oversized bodies with 413', async () => {
      const res = await telemetry(JSON.stringify({ shipmentId, pad: 'x'.repeat(20_000) }));
      await expectError(res, 413, 'PAYLOAD_TOO_LARGE');
    });
  });
});

describe('error handling', () => {
  it('returns a JSON 404 for unknown API routes', async () => {
    await expectError(await send('GET', '/api/does-not-exist'), 404, 'ROUTE_NOT_FOUND');
  });

  it('refuses to reset a shipment that is not the demo shipment', async () => {
    db.prepare(
      `INSERT INTO shipments (id, code, produce, origin, destination, retailer, status, quantity_kg, original_price_per_kg,
         baseline_shelf_life_hours, transit_total_hours, transit_remaining_hours, cumulative_equivalent_age_hours,
         current_temperature_c, current_humidity_pct, created_at, updated_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'OTHER-1', 'x', 'x', 'x', 'x', 'IN_TRANSIT', 1, 1, 120, 1, 1, 0, 4, 60, 'now', 'now')`,
    ).run();
    await expectError(
      await send('POST', '/api/shipments/11111111-1111-4111-8111-111111111111/reset'),
      403,
      'RESET_NOT_ALLOWED',
    );
    db.prepare("DELETE FROM shipments WHERE code = 'OTHER-1'").run();
  });

  it('resets the demo shipment to its initial state under the same id', async () => {
    const res = await send('POST', `/api/shipments/${shipmentId}/reset`);
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.shipment.id).toBe(shipmentId);
    expect(detail.current.riskLevel).toBe('NORMAL');
    expect(detail.listing.currentPricePerKg).toBe(100);
    expect(detail.alerts).toHaveLength(0);
    expect(detail.telemetry).toHaveLength(0);
  });
});

describe("primary action: POST /api/shipments/:id/simulate-spike", () => {
  it("generates the reading server-side, runs the pipeline and returns the complete state", async () => {
    const res = await send("POST", `/api/shipments/${shipmentId}/simulate-spike`);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.scenario).toBe("ambient-spike");
    expect(body.readings).toEqual({ temperature: 30, humidity: 85, transitDuration: 6.3 });
    expect(body.event.id).toEqual(expect.any(String));
    expect(body.shipment.current.riskLevel).toBe("CRITICAL");
    expect(body.shipment.current.remainingHours).toBeGreaterThan(17);
    expect(body.shipment.current.remainingHours).toBeLessThan(18);
    expect(body.shipment.current.temperature).toBe(30);
    expect(body.shipment.current.humidity).toBe(85);
    expect(body.shipment.listing).toMatchObject({ currentPricePerKg: 65, discountPct: 35, status: "LIQUIDATION" });
    expect(body.shipment.recommendations).toHaveLength(1);
    expect(body.shipment.alerts).toHaveLength(1);
  });

  it("ignores any client-supplied readings: the values come from the server", async () => {
    const res = await send("POST", `/api/shipments/${shipmentId}/simulate-spike`, { temperature: -40, humidity: 0, transitDuration: 0 });
    const body = await res.json();
    expect(body.readings.temperature).toBe(30);
  });

  it("persists the event: it is visible from the telemetry history afterwards", async () => {
    const body = await (await send("GET", `/api/shipments/${shipmentId}/telemetry`)).json();
    expect(body.events.some((e: { temperature: number }) => e.temperature === 30)).toBe(true);
  });

  it("returns 404 for an unknown shipment and writes nothing", async () => {
    const before = await telemetryCount();
    await expectError(await send("POST", `/api/shipments/${MISSING_ID}/simulate-spike`), 404, "NOT_FOUND");
    expect(await telemetryCount()).toBe(before);
  });

  it("returns 400 for a malformed id", async () => {
    await expectError(await send("POST", "/api/shipments/nope/simulate-spike"), 400, "INVALID_ID");
  });

  it("the normal-reading scenario is also server-generated", async () => {
    const body = await (await send("POST", `/api/shipments/${shipmentId}/simulate-normal`)).json();
    expect(body.scenario).toBe("normal-reading");
    expect(body.readings).toEqual({ temperature: 4, humidity: 60, transitDuration: 2 });
  });
});

describe("secondary read models", () => {
  it("marketplace reads the listing: normal before the event, liquidation after it", async () => {
    await send("POST", `/api/shipments/${shipmentId}/reset`);
    let body = await (await send("GET", "/api/marketplace")).json();
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toMatchObject({
      code: "AS-1042",
      origin: "Hosur Farm Hub",
      destination: "Coimbatore",
      originalPricePerKg: 100,
      currentPricePerKg: 100,
      discountPct: 0,
      listingStatus: "NORMAL",
      riskLevel: "NORMAL",
      urgency: "NONE",
      availableKg: 1200,
    });
    expect(body.listings[0].remainingHours).toBeCloseTo(120, 6);

    await send("POST", `/api/shipments/${shipmentId}/simulate-spike`);
    body = await (await send("GET", "/api/marketplace")).json();
    expect(body.listings[0]).toMatchObject({
      currentPricePerKg: 65,
      discountPct: 35,
      listingStatus: "LIQUIDATION",
      riskLevel: "CRITICAL",
      urgency: "IMMEDIATE",
    });
    expect(body.listings[0].remainingHours).toBeLessThan(18);
  });

  it("alerts come from the database, with the recommended action and markdown", async () => {
    await send("POST", `/api/shipments/${shipmentId}/reset`);
    expect((await (await send("GET", "/api/alerts")).json()).alerts).toHaveLength(0);

    await send("POST", `/api/shipments/${shipmentId}/simulate-spike`);
    const { alerts } = await (await send("GET", "/api/alerts")).json();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      code: "AS-1042",
      severity: "CRITICAL",
      markdownPct: 35,
      recommendedPricePerKg: 65,
      recommendedAction: "Liquidate to local retailers at 35% markdown",
    });
    expect(alerts[0].remainingHours).toBeGreaterThan(17);
    expect(alerts[0].remainingHours).toBeLessThan(18);
  });

  it("telemetry history classifies each reading and links it to its snapshot", async () => {
    await send("POST", `/api/shipments/${shipmentId}/reset`);
    await send("POST", `/api/shipments/${shipmentId}/simulate-normal`);
    await send("POST", `/api/shipments/${shipmentId}/simulate-spike`);
    const body = await (await send("GET", `/api/shipments/${shipmentId}/telemetry-history`)).json();
    expect(body.entries.map((e: { kind: string }) => e.kind)).toEqual(["NORMAL_TELEMETRY", "THERMAL_EXCURSION"]);
    const excursion = body.entries[1];
    expect(excursion).toMatchObject({ temperature: 30, humidity: 85, exposureHours: 6.3, riskLevel: "CRITICAL" });
    expect(excursion.remainingHours).toBeLessThan(18);
    expect(excursion.explanation).toContain("30.0 °C");
  });

  it("telemetry history returns 404 for an unknown shipment", async () => {
    await expectError(await send("GET", `/api/shipments/${MISSING_ID}/telemetry-history`), 404, "NOT_FOUND");
  });
});
