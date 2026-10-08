import express, { type NextFunction, type Request, type Response } from 'express';
import type { Db } from './db.js';
import { NotFoundError, getShipmentRow, getShipmentState, ingestTelemetry } from './pipeline.js';
import { resetDemoShipment, seedDemoShipment } from './seed.js';
import { validateTelemetry } from './validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /** Returns the demo shipment's state. Seeds it on first request. */
  app.get('/api/shipment', (_req, res) => {
    const id = seedDemoShipment(db);
    res.json(getShipmentState(db, id));
  });

  app.get('/api/shipments/:id', (req, res) => {
    const id = requireId(req.params.id, res);
    if (!id) return;
    res.json(getShipmentState(db, id));
  });

  /** Telemetry ingest: validate, persist, recalculate, liquidate, alert, audit. */
  app.post('/api/shipments/:id/telemetry', (req, res) => {
    const id = requireId(req.params.id, res);
    if (!id) return;

    const validation = validateTelemetry(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: 'Invalid telemetry event.', details: validation.errors });
      return;
    }

    try {
      ingestTelemetry(db, id, validation.value);
      res.status(201).json(getShipmentState(db, id));
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  /** Restores the demo shipment to its initial state. */
  app.post('/api/shipments/:id/reset', (req, res) => {
    const id = requireId(req.params.id, res);
    if (!id) return;
    try {
      getShipmentRow(db, id);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
    const newId = resetDemoShipment(db);
    res.json(getShipmentState(db, newId));
  });

  // Scoped to /api so page requests fall through to the static or Vite handler.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Malformed JSON, oversized bodies, and any unexpected failure end here.
  app.use((error: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body.' });
      return;
    }
    if (error.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large.' });
      return;
    }
    // Log the error type only; never echo SQL or internal messages to the client.
    console.error('[agrosense] request failed:', error.name);
    res.status(500).json({ error: 'Internal error. The change was not saved.' });
  });

  return app;
}

function requireId(raw: string, res: Response): string | null {
  if (!UUID.test(raw)) {
    res.status(400).json({ error: 'Invalid shipment id.' });
    return null;
  }
  return raw;
}
