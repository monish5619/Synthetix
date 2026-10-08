import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ApiError, EngineError } from './errors.js';
import { DEMO_SHIPMENT } from './demo.js';
import type { Db } from './db.js';
import { inTransaction } from './db.js';
import { checkDegradationEngine, checkLiquidationEngine, type HealthReport } from './health.js';
import { hashRequest, isDatabaseUnavailable, isValidIdempotencyKey } from './guards.js';
import { openStream, publishChange } from './events.js';
import { getShipmentDetail, getShipmentRow, ingestTelemetry, listShipments, listTelemetry } from './pipeline.js';
import { previewTelemetry } from './preview.js';
import { resetDemoShipment } from './seed.js';
import { SCENARIOS, type ScenarioName } from './simulator.js';
import { validateTelemetry } from './validation.js';
import { fixedWindowLimiter } from './ratelimit.js';
import { acknowledgeAlert, claimListing, listAlerts, listMarketplace, telemetryHistory } from './views.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppOptions {
  /** Exact origins allowed to call the API cross-origin. Empty means same-origin only. */
  allowedOrigins: readonly string[];
  /** Enables the scripted demo endpoints (simulate, reset). */
  demoMode: boolean;
  /** When set, external telemetry requires this key in X-Ingest-Key. */
  ingestApiKey?: string | null;
  /** Maximum write requests per client per minute. */
  rateLimitPerMinute?: number;
}

/**
 * API contract. Every error response has the shape:
 *   { "error": { "code": string, "message": string, "details"?: string[] } }
 */
export function createApp(db: Db, options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use('/api', securityHeaders);
  app.use('/api', corsFor(options.allowedOrigins));
  app.use(express.json({ limit: '10kb' }));

  // Every write is counted per client. Reads are not limited.
  const allowWrite = fixedWindowLimiter(options.rateLimitPerMinute ?? 100_000);
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && !allowWrite(req.ip ?? 'unknown')) {
      res.setHeader('Retry-After', '60');
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.');
    }
    next();
  });

  /** Reaching this handler means the telemetry API is up. The database and engines are checked live. */
  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable. Try again shortly.');
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
    res.json(getShipmentDetail(db, parseId(req.params.id)));
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

  /**
   * External telemetry ingest: validate, persist, recalculate, liquidate, alert, audit.
   * Optional Idempotency-Key header: a retry with the same key and body returns the
   * original result, and writes nothing new.
   */
  app.post('/api/telemetry', (req, res) => {
    requireIngestKey(req, options.ingestApiKey);
    const validation = validateTelemetry(req.body);
    if (!validation.ok) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Telemetry request is invalid.', validation.errors);
    }
    const { value } = validation;
    idempotent(req, res, db, 'POST /api/telemetry', { shipmentId: value.shipmentId, ...reqBody(req) }, () => {
      const event = ingestTelemetry(db, value);
      publishChange({ shipmentId: value.shipmentId, kind: 'telemetry' });
      return { event, shipment: getShipmentDetail(db, value.shipmentId) };
    });
  });

  /** Live changes: a tiny "something changed" message after each successful write. Clients refetch from the normal API. */
  app.get('/api/stream', (req, res) => openStream(req, res));

  /**
   * Simulator preview (demo): what a reading WOULD do, from the real model and liquidation
   * engine. Read-only: nothing is written, so it can be repeated freely.
   */
  app.post('/api/shipments/:id/preview', (req, res) => {
    requireDemo(options);
    const id = parseId(req.params.id as string);
    getShipmentRow(db, id);
    const validation = validateTelemetry({ ...reqBody(req), shipmentId: id });
    if (!validation.ok) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Reading is invalid.', validation.errors);
    }
    res.json(previewTelemetry(db, validation.value));
  });

  /**
   * Simulator commit (demo): the browser may send a reading, but never holds the ingest
   * key, so this demo-only route applies the same validation and the very same
   * `ingestTelemetry` pipeline as POST /api/telemetry.
   */
  app.post('/api/shipments/:id/simulate', (req, res) => {
    requireDemo(options);
    const id = parseId(req.params.id as string);
    getShipmentRow(db, id);
    const validation = validateTelemetry({ ...reqBody(req), shipmentId: id });
    if (!validation.ok) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Reading is invalid.', validation.errors);
    }
    const { value } = validation;
    idempotent(req, res, db, 'POST simulate', { shipmentId: id, ...reqBody(req) }, () => {
      const event = ingestTelemetry(db, value);
      publishChange({ shipmentId: id, kind: 'telemetry' });
      return { event, shipment: getShipmentDetail(db, id) };
    });
  });

  /**
   * Demo primary action. The server generates the reading, so the browser sends no values.
   * The reading goes through the same validation and pipeline as external telemetry.
   */
  app.post('/api/shipments/:id/simulate-spike', (req, res) => {
    requireDemo(options);
    runScenario(req, res, db, 'ambient-spike');
  });

  app.post('/api/shipments/:id/simulate-normal', (req, res) => {
    requireDemo(options);
    runScenario(req, res, db, 'normal-reading');
  });

  /** Retailer acknowledges a spoilage alert. Idempotent: the first acknowledgement time is kept. */
  app.post('/api/alerts/:id/acknowledge', (req, res) => {
    const raw = req.params.id as string;
    if (!UUID.test(raw)) throw new ApiError(400, 'INVALID_ID', 'Alert id is not valid.');
    res.json({ alert: acknowledgeAlert(db, raw) });
  });

  /**
   * A retailer claims stock from a listing (the "rescue deal"). Atomic and idempotent with an
   * Idempotency-Key. No login yet: full role-based auth is deferred; abuse is bounded by the
   * write rate limit, strict validation, and the stock check inside the transaction.
   */
  app.post('/api/listings/:id/claim', (req, res) => {
    const raw = req.params.id as string;
    if (!UUID.test(raw)) throw new ApiError(400, 'INVALID_ID', 'Listing id is not valid.');
    const body = reqBody(req);
    const q = body.quantityKg;
    if (q !== undefined && (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > 1_000_000)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'quantityKg must be a positive number.');
    }
    idempotent(req, res, db, `POST claim ${raw}`, body, () => ({ claim: claimListing(db, raw, q as number | undefined) }));
  });

  /** Demo only: restores the demo shipment to its initial state under the same id. */
  app.post('/api/shipments/:id/reset', (req, res) => {
    requireDemo(options);
    const id = parseId(req.params.id);
    if (getShipmentRow(db, id).code !== DEMO_SHIPMENT.code) {
      throw new ApiError(403, 'RESET_NOT_ALLOWED', 'Only the demo shipment can be reset.');
    }
    const resetId = resetDemoShipment(db);
    publishChange({ shipmentId: resetId, kind: 'reset' });
    res.json(getShipmentDetail(db, resetId));
  });

  // Scoped to /api so page requests fall through to the static or Vite handler.
  app.use('/api', (_req, _res) => {
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'No such API route.');
  });

  app.use(errorHandler);
  return app;
}

/* ---------- request helpers ---------- */

function parseId(raw: string): string {
  if (!UUID.test(raw)) throw new ApiError(400, 'INVALID_ID', 'Shipment id is not valid.');
  return raw;
}

function reqBody(req: Request): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};
}

/** Compares digests in constant time, so the key cannot be probed byte by byte. */
function requireIngestKey(req: Request, expected: string | null | undefined) {
  if (!expected) return;
  const given = req.get('X-Ingest-Key') ?? '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  if (given === '' || !timingSafeEqual(a, b)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid ingest key.');
  }
}

function requireDemo(options: AppOptions) {
  if (!options.demoMode) throw new ApiError(403, 'DEMO_DISABLED', 'Demo controls are disabled on this deployment.');
}

function runScenario(req: Request, res: Response, db: Db, scenario: ScenarioName) {
  const id = parseId(req.params.id as string);
  getShipmentRow(db, id); // 404 before anything is generated
  idempotent(req, res, db, `POST ${scenario}`, { shipmentId: id, scenario }, () => {
    const reading = SCENARIOS[scenario];
    const validation = validateTelemetry({ shipmentId: id, ...reading });
    if (!validation.ok) {
      // Scenario values are fixed in code, so this fires only if a scenario definition is wrong.
      throw new EngineError('scenario definition failed validation');
    }
    const event = ingestTelemetry(db, validation.value);
    publishChange({ shipmentId: id, kind: 'telemetry' });
    return { scenario, readings: reading, event, shipment: getShipmentDetail(db, id) };
  });
}

/**
 * Runs a write at most once per Idempotency-Key. The key check, the write, and the
 * stored response share one transaction, so a crash cannot record a key without its work.
 * Without the header, the write simply runs.
 */
function idempotent(
  req: Request,
  res: Response,
  db: Db,
  scope: string,
  body: unknown,
  work: () => unknown,
) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) {
    res.status(201).json(work());
    return;
  }
  // A repeated header arrives as an array. Treat that as malformed rather than guessing.
  const header = Array.isArray(raw) ? '' : raw;
  if (!isValidIdempotencyKey(header)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Idempotency-Key must be 8 to 128 letters, digits, hyphens, or underscores.');
  }

  const requestHash = hashRequest(scope, body);
  const outcome = inTransaction(db, () => {
    const stored = db
      .prepare('SELECT request_hash, response_json FROM idempotency_keys WHERE key = ? AND scope = ?')
      .get(header, scope) as { request_hash: string; response_json: string } | undefined;
    if (stored) {
      if (stored.request_hash !== requestHash) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request.');
      }
      return { replayed: true, payload: JSON.parse(stored.response_json) as unknown };
    }
    const payload = work();
    db.prepare('INSERT INTO idempotency_keys (key, scope, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      header,
      scope,
      requestHash,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
    return { replayed: false, payload };
  });

  res.setHeader('Idempotent-Replayed', outcome.replayed ? 'true' : 'false');
  res.status(201).json(outcome.payload);
}

/* ---------- middleware ---------- */

function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Live operational data must never be served from a cache.
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * CORS allows only the exact origins listed in configuration. There is no wildcard and
 * no credentials. A request from any other origin receives no CORS headers, so the
 * browser blocks it. Preflight requests from unlisted origins get a bare 204.
 */
function corsFor(allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction) => {
    res.vary('Origin');
    const origin = req.get('Origin');
    if (origin && allowedSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/* ---------- errors ---------- */

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
  if (isDatabaseUnavailable(error)) {
    console.error('[agrosense] database unavailable');
    res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable. Try again shortly.' } });
    return;
  }
  if (error instanceof EngineError) {
    // Nothing was written: the pipeline runs inside a transaction that rolled back.
    console.error(`[agrosense] engine failure: ${error.name}`);
    res.status(500).json({ error: { code: 'MODEL_FAILURE', message: 'The reading could not be processed. Nothing was saved.' } });
    return;
  }

  // Log the error class only. Messages, stacks, and SQL never reach the client or the log.
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`[agrosense] unhandled error: ${name}`);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
