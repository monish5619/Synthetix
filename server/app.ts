import express, { type NextFunction, type Request, type Response } from 'express';
import { ApiError } from './errors.js';
import { DEMO_SHIPMENT } from './demo.js';
import type { Db } from './db.js';
import { getShipmentDetail, getShipmentRow, ingestTelemetry, listShipments, listTelemetry } from './pipeline.js';
import { resetDemoShipment } from './seed.js';
import { SCENARIOS, type ScenarioName } from './simulator.js';
import { checkDegradationEngine, checkLiquidationEngine, type HealthReport } from './health.js';
import { validateTelemetry } from './validation.js';
import { listAlerts, listMarketplace, telemetryHistory } from './views.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * API contract. Every error response has the shape:
 *   { "error": { "code": string, "message": string, "details"?: string[] } }
 */
export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  /** Reaching this handler means the telemetry API is up. The database and engines are checked live. */
  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database is not reachable.');
    }
    const report: HealthReport = {
      telemetryApi: 'ONLINE',
      database: 'CONNECTED',
      degradationEngine: checkDegradationEngine(),
      liquidationEngine: checkLiquidationEngine(),
      checkedAt: new Date().toISOString(),
    };
    res.json(report);
  });

  app.get('/api/shipments', (_req, res) => {
    res.json({ shipments: listShipments(db) });
  });

  /** Marketplace: every listing with its shipment, risk, and latest recommendation. */
  app.get('/api/marketplace', (_req, res) => {
    res.json({ listings: listMarketplace(db) });
  });

  /** Alerts: every spoilage alert from the database, newest first. */
  app.get('/api/alerts', (_req, res) => {
    res.json({ alerts: listAlerts(db) });
  });

  app.get('/api/shipments/:id', (req, res) => {
    const id = parseId(req.params.id);
    res.json(getShipmentDetail(db, id));
  });

  /** Telemetry events joined to the snapshot each one produced. */
  app.get('/api/shipments/:id/telemetry-history', (req, res) => {
    const id = parseId(req.params.id);
    getShipmentRow(db, id);
    const entries = telemetryHistory(db, id);
    res.json({ shipmentId: id, count: entries.length, entries });
  });

  app.get('/api/shipments/:id/telemetry', (req, res) => {
    const id = parseId(req.params.id);
    const events = listTelemetry(db, id);
    res.json({ shipmentId: id, count: events.length, events });
  });

  /** External telemetry ingest: validate, persist, recalculate, liquidate, alert, audit. */
  app.post('/api/telemetry', (req, res) => {
    const validation = validateTelemetry(req.body);
    if (!validation.ok) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Telemetry request is invalid.', validation.errors);
    }
    const event = ingestTelemetry(db, validation.value);
    res.status(201).json({ event, shipment: getShipmentDetail(db, validation.value.shipmentId) });
  });

  /**
   * Primary demo action. The server generates the reading, so the browser sends no values.
   * The reading goes through the same validation and pipeline as external telemetry, and
   * the complete updated state is returned.
   */
  app.post('/api/shipments/:id/simulate-spike', (req, res) => {
    runScenario(req.params.id, 'ambient-spike', res);
  });

  app.post('/api/shipments/:id/simulate-normal', (req, res) => {
    runScenario(req.params.id, 'normal-reading', res);
  });

  /** Demo-only: restores the demo shipment to its initial state under the same id. */
  app.post('/api/shipments/:id/reset', (req, res) => {
    const id = parseId(req.params.id);
    if (getShipmentRow(db, id).code !== DEMO_SHIPMENT.code) {
      throw new ApiError(403, 'RESET_NOT_ALLOWED', 'Only the demo shipment can be reset.');
    }
    res.json(getShipmentDetail(db, resetDemoShipment(db)));
  });

  // Scoped to /api so page requests fall through to the static or Vite handler.
  app.use('/api', (_req, _res) => {
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'No such API route.');
  });

  app.use(errorHandler);

  function runScenario(rawId: string, scenario: ScenarioName, res: Response) {
    const id = parseId(rawId);
    getShipmentRow(db, id); // 404 before anything is generated

    const reading = SCENARIOS[scenario];
    const validation = validateTelemetry({ shipmentId: id, ...reading });
    if (!validation.ok) {
      // Scenario values are fixed in code, so this fires only if a scenario definition is wrong.
      throw new Error(`Scenario ${scenario} failed validation`);
    }

    const event = ingestTelemetry(db, validation.value);
    res.status(201).json({
      scenario,
      readings: reading,
      event,
      shipment: getShipmentDetail(db, id),
    });
  }

  return app;
}

function parseId(raw: string): string {
  if (!UUID.test(raw)) throw new ApiError(400, 'INVALID_ID', 'Shipment id is not valid.');
  return raw;
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }

  const type = (error as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    return;
  }

  // Log the error class only. Messages, stacks, and SQL never reach the client or the log.
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`[agrosense] unhandled error: ${name}`);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. The change was not saved.' } });
}
