import express, { type NextFunction, type Request, type Response } from 'express';
import { ApiError } from './errors.js';
import { DEMO_SHIPMENT } from './demo.js';
import type { Db } from './db.js';
import { getShipmentDetail, getShipmentRow, ingestTelemetry, listShipments, listTelemetry } from './pipeline.js';
import { resetDemoShipment } from './seed.js';
import { validateTelemetry } from './validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * API contract. Every error response has the shape:
 *   { "error": { "code": string, "message": string, "details"?: string[] } }
 */
export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database is not reachable.');
    }
    res.json({ status: 'ok', database: 'ok' });
  });

  app.get('/api/shipments', (_req, res) => {
    res.json({ shipments: listShipments(db) });
  });

  app.get('/api/shipments/:id', (req, res) => {
    const id = parseId(req.params.id);
    res.json(getShipmentDetail(db, id));
  });

  app.get('/api/shipments/:id/telemetry', (req, res) => {
    const id = parseId(req.params.id);
    const events = listTelemetry(db, id);
    res.json({ shipmentId: id, count: events.length, events });
  });

  /** Ingests one telemetry reading and returns the event plus the updated shipment. */
  app.post('/api/telemetry', (req, res) => {
    const validation = validateTelemetry(req.body);
    if (!validation.ok) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Telemetry request is invalid.', validation.errors);
    }
    const event = ingestTelemetry(db, validation.value);
    res.status(201).json({ event, shipment: getShipmentDetail(db, validation.value.shipmentId) });
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
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
