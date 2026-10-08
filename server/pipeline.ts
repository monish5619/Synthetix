import { randomUUID } from 'node:crypto';
import { inTransaction, type Db } from './db.js';
import { EngineError, notFound } from './errors.js';
import {
  EXCURSION_ABOVE_IDEAL_C,
  LIQUIDATION_POLICY,
  MODEL_CONFIG,
  MODEL_VERSION,
  RISK_BANDS,
  RISK_ORDER,
  type RiskLevel,
} from './config.js';
import { decideLiquidation } from './liquidation.js';
import { classifyRisk, evaluateExposure, type ModelOutput } from './model.js';
import type { TelemetryRequest } from './validation.js';

/* ---------- row types (internal, snake_case as stored) ---------- */

interface ShipmentRow {
  id: string;
  code: string;
  produce: string;
  origin: string;
  destination: string;
  retailer: string;
  status: 'IN_TRANSIT' | 'ARRIVED';
  quantity_kg: number;
  original_price_per_kg: number;
  baseline_shelf_life_hours: number;
  transit_total_hours: number;
  transit_remaining_hours: number;
  cumulative_equivalent_age_hours: number;
  current_temperature_c: number;
  current_humidity_pct: number;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  id: string;
  model_version: string;
  temperature_c: number;
  humidity_pct: number;
  exposure_hours: number;
  temperature_stress: number;
  humidity_factor: number;
  equivalent_age_increment: number;
  cumulative_equivalent_age: number;
  remaining_hours: number;
  transit_remaining_hours: number;
  risk_level: RiskLevel;
  explanation: string;
  created_at: string;
}

interface TelemetryRow {
  id: string;
  shipment_id: string;
  temperature_c: number;
  humidity_pct: number;
  exposure_hours: number;
  recorded_at: string;
}

/* ---------- reads ---------- */

export function getShipmentRow(db: Db, shipmentId: string): ShipmentRow {
  const row = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId) as ShipmentRow | undefined;
  if (!row) throw notFound('Shipment not found.');
  return row;
}

/** Remaining shelf life is derived from the stored cumulative ageing. It is never stored separately. */
function remainingOf(row: ShipmentRow) {
  const remainingHours = Math.max(0, row.baseline_shelf_life_hours - row.cumulative_equivalent_age_hours);
  return { remainingHours, remainingDays: remainingHours / 24, riskLevel: classifyRisk(remainingHours) };
}

function latestSnapshot(db: Db, shipmentId: string): SnapshotRow | undefined {
  return db
    .prepare('SELECT * FROM shelf_life_snapshots WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(shipmentId) as SnapshotRow | undefined;
}

function currentPricePerKg(db: Db, shipmentId: string): number {
  const row = db
    .prepare('SELECT current_price_per_kg FROM marketplace_listings WHERE shipment_id = ?')
    .get(shipmentId) as { current_price_per_kg: number } | undefined;
  return row?.current_price_per_kg ?? 0;
}

export interface ShipmentSummary {
  id: string;
  code: string;
  produce: string;
  status: ShipmentRow['status'];
  currentTemperature: number;
  currentHumidity: number;
  remainingHours: number;
  riskLevel: RiskLevel;
  currentPricePerKg: number;
}

export function listShipments(db: Db): ShipmentSummary[] {
  const rows = db
    .prepare('SELECT * FROM shipments ORDER BY created_at ASC, rowid ASC')
    .all() as unknown as ShipmentRow[];
  return rows.map((row) => {
    const { remainingHours, riskLevel } = remainingOf(row);
    return {
      id: row.id,
      code: row.code,
      produce: row.produce,
      status: row.status,
      currentTemperature: row.current_temperature_c,
      currentHumidity: row.current_humidity_pct,
      remainingHours,
      riskLevel,
      currentPricePerKg: currentPricePerKg(db, row.id),
    };
  });
}

export interface TelemetryEventView {
  id: string;
  shipmentId: string;
  temperature: number;
  humidity: number;
  transitDuration: number;
  recordedAt: string;
}

function toTelemetryView(row: TelemetryRow): TelemetryEventView {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    temperature: row.temperature_c,
    humidity: row.humidity_pct,
    transitDuration: row.exposure_hours,
    recordedAt: row.recorded_at,
  };
}

/** Persisted telemetry for one shipment, oldest first. Throws if the shipment is unknown. */
export function listTelemetry(db: Db, shipmentId: string, limit = 500): TelemetryEventView[] {
  getShipmentRow(db, shipmentId);
  const rows = db
    .prepare(
      `SELECT * FROM telemetry_events WHERE shipment_id = ?
       ORDER BY recorded_at ASC, rowid ASC LIMIT ?`,
    )
    .all(shipmentId, limit) as unknown as TelemetryRow[];
  return rows.map(toTelemetryView);
}

/** Full shipment detail, read from the database. */
export function getShipmentDetail(db: Db, shipmentId: string) {
  const row = getShipmentRow(db, shipmentId);
  const snapshot = latestSnapshot(db, shipmentId);
  const { remainingHours, remainingDays, riskLevel } = remainingOf(row);
  const listing = db
    .prepare(
      `SELECT current_price_per_kg AS currentPricePerKg, discount_pct AS discountPct, status, updated_at AS updatedAt
       FROM marketplace_listings WHERE shipment_id = ?`,
    )
    .get(shipmentId) as { currentPricePerKg: number; discountPct: number; status: string; updatedAt: string };

  return {
    shipment: {
      id: row.id,
      code: row.code,
      produce: row.produce,
      origin: row.origin,
      destination: row.destination,
      retailer: row.retailer,
      status: row.status,
      quantityKg: row.quantity_kg,
      originalPricePerKg: row.original_price_per_kg,
      baselineShelfLifeHours: row.baseline_shelf_life_hours,
      transitTotalHours: row.transit_total_hours,
      idealTemperatureC: MODEL_CONFIG.idealTemperatureC,
      updatedAt: row.updated_at,
    },
    current: {
      temperature: row.current_temperature_c,
      humidity: row.current_humidity_pct,
      transitRemainingHours: row.transit_remaining_hours,
      cumulativeEquivalentAge: row.cumulative_equivalent_age_hours,
      remainingHours,
      remainingDays,
      riskLevel,
      explanation: snapshot?.explanation ?? '',
      modelVersion: snapshot?.model_version ?? '',
    },
    model: {
      modelVersion: MODEL_VERSION,
      ...MODEL_CONFIG,
      riskBands: RISK_BANDS,
      liquidationPolicy: LIQUIDATION_POLICY,
      excursionAboveIdealC: EXCURSION_ABOVE_IDEAL_C,
    },
    latestModelRun: snapshot ? toModelRun(snapshot) : null,
    listing: {
      basePricePerKg: row.original_price_per_kg,
      ...listing,
    },
    recommendations: db
      .prepare(
        `SELECT id, risk_level AS riskLevel, markdown_pct AS markdownPct, original_price_per_kg AS originalPricePerKg,
           recommended_price_per_kg AS recommendedPricePerKg, sell_by_hours AS sellByHours, urgency, reason,
           retailer_action AS retailerAction, status, created_at AS createdAt
         FROM liquidation_recommendations WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10`,
      )
      .all(shipmentId) as unknown as RecommendationView[],
    alerts: db
      .prepare(
        `SELECT id, severity, recipient, message, created_at AS createdAt
         FROM spoilage_alerts WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10`,
      )
      .all(shipmentId) as unknown as AlertView[],
    telemetry: listTelemetry(db, shipmentId, 200),
    snapshots: db
      .prepare(
        `SELECT remaining_hours AS remainingHours, transit_remaining_hours AS transitRemainingHours,
           temperature_c AS temperatureC, humidity_pct AS humidityPct, exposure_hours AS exposureHours,
           equivalent_age_increment AS equivalentAgeIncrement,
           risk_level AS riskLevel, created_at AS createdAt
         FROM shelf_life_snapshots WHERE shipment_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 200`,
      )
      .all(shipmentId) as unknown as SnapshotView[],
    audit: db
      .prepare(
        `SELECT id, event_type AS eventType, summary, detail_json AS detailJson, created_at AS createdAt
         FROM audit_logs WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 40`,
      )
      .all(shipmentId) as unknown as AuditView[],
  };
}

export interface RecommendationView {
  id: string;
  riskLevel: RiskLevel;
  markdownPct: number;
  originalPricePerKg: number;
  recommendedPricePerKg: number;
  sellByHours: number;
  urgency: string;
  reason: string;
  retailerAction: string;
  status: string;
  createdAt: string;
}

export interface AlertView {
  id: string;
  severity: RiskLevel;
  recipient: string;
  message: string;
  createdAt: string;
}

export interface AuditView {
  id: string;
  eventType: string;
  summary: string;
  detailJson: string;
  createdAt: string;
}

function toModelRun(s: SnapshotRow) {
  return {
    modelVersion: s.model_version,
    temperatureC: s.temperature_c,
    humidityPct: s.humidity_pct,
    exposureHours: s.exposure_hours,
    temperatureStress: s.temperature_stress,
    humidityFactor: s.humidity_factor,
    equivalentAgeIncrement: s.equivalent_age_increment,
    cumulativeEquivalentAge: s.cumulative_equivalent_age,
    remainingHours: s.remaining_hours,
    remainingDays: s.remaining_hours / 24,
    transitRemainingHours: s.transit_remaining_hours,
    riskLevel: s.risk_level,
    explanation: s.explanation,
    createdAt: s.created_at,
  };
}

export type ShipmentDetail = ReturnType<typeof getShipmentDetail>;

/* ---------- writes ---------- */

const now = () => new Date().toISOString();

/**
 * Telemetry pipeline, one transaction. Any failure rolls back every write.
 *   1. persist the telemetry event
 *   2. run the degradation model on the exposure interval
 *   3. persist the shelf-life snapshot
 *   4. record risk escalation
 *   5. liquidation decision → recommendation and marketplace update
 *   6. spoilage alert on escalation into HIGH or CRITICAL
 *   7. update shipment state and write audit events
 * Input must already be validated.
 */
export function ingestTelemetry(db: Db, request: TelemetryRequest): TelemetryEventView {
  return inTransaction(db, () => {
    const row = getShipmentRow(db, request.shipmentId);
    const ts = now();
    const previous = latestSnapshot(db, row.id);
    const previousRisk: RiskLevel = previous?.risk_level ?? 'NORMAL';

    const output = engineStep('degradation model', () =>
      evaluateExposure({
        baselineShelfLifeHours: row.baseline_shelf_life_hours,
        cumulativeBefore: row.cumulative_equivalent_age_hours,
        exposure: {
          temperatureC: request.temperature,
          humidityPct: request.humidity,
          exposureHours: request.transitDuration,
        },
      }),
    );
    const transitRemaining = Math.max(0, row.transit_remaining_hours - request.transitDuration);

    const telemetryId = randomUUID();
    db.prepare(
      `INSERT INTO telemetry_events (id, shipment_id, temperature_c, humidity_pct, exposure_hours, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(telemetryId, row.id, request.temperature, request.humidity, request.transitDuration, ts);

    const snapshotId = insertSnapshot(db, row.id, telemetryId, output, transitRemaining, ts);
    audit(
      db,
      row.id,
      'TELEMETRY_RECEIVED',
      `Reading ${request.temperature} °C / ${request.humidity} % RH over ${request.transitDuration} h`,
      { telemetryId, temperature: request.temperature, humidity: request.humidity, exposureHours: request.transitDuration },
      ts,
    );
    audit(
      db,
      row.id,
      'SHELF_LIFE_RECALCULATED',
      `Remaining shelf life ${output.remainingHours.toFixed(2)} h (${output.equivalentAgeIncrement.toFixed(2)} h added) · risk ${output.riskLevel}`,
      { snapshotId, modelVersion: output.modelVersion, explanation: output.explanation },
      ts,
    );

    const escalated = RISK_ORDER[output.riskLevel] > RISK_ORDER[previousRisk];
    if (escalated) {
      audit(db, row.id, 'RISK_ESCALATED', `Risk ${previousRisk} → ${output.riskLevel}`, { from: previousRisk, to: output.riskLevel }, ts);
    }

    const listing = db
      .prepare('SELECT discount_pct FROM marketplace_listings WHERE shipment_id = ?')
      .get(row.id) as { discount_pct: number };
    const decision = engineStep('liquidation engine', () =>
      decideLiquidation({
        output,
        originalPricePerKg: row.original_price_per_kg,
        previousMarkdownPct: listing.discount_pct,
      }),
    );

    if (decision.deepened) {
      db.prepare(
        `UPDATE marketplace_listings SET current_price_per_kg = ?, discount_pct = ?, status = ?, updated_at = ?
         WHERE shipment_id = ?`,
      ).run(
        decision.recommendedPricePerKg,
        decision.markdownPct,
        decision.markdownPct > 0 ? 'LIQUIDATION' : 'NORMAL',
        ts,
        row.id,
      );
      db.prepare(
        `INSERT INTO liquidation_recommendations (id, shipment_id, snapshot_id, risk_level, markdown_pct,
           original_price_per_kg, recommended_price_per_kg, sell_by_hours, urgency, reason, retailer_action, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?)`,
      ).run(
        randomUUID(),
        row.id,
        snapshotId,
        output.riskLevel,
        decision.markdownPct,
        decision.originalPricePerKg,
        decision.recommendedPricePerKg,
        decision.sellByHours,
        decision.urgency,
        decision.reason,
        decision.retailerAction,
        ts,
      );
      audit(
        db,
        row.id,
        'LIQUIDATION_RECOMMENDED',
        `${decision.markdownPct}% markdown: ₹${decision.originalPricePerKg}/kg → ₹${decision.recommendedPricePerKg}/kg (${decision.urgency})`,
        { riskLevel: output.riskLevel, markdownPct: decision.markdownPct, reason: decision.reason },
        ts,
      );
      audit(
        db,
        row.id,
        'MARKETPLACE_UPDATED',
        `Listing repriced to ₹${decision.recommendedPricePerKg}/kg`,
        { currentPricePerKg: decision.recommendedPricePerKg, discountPct: decision.markdownPct },
        ts,
      );
    }

    if (escalated && (output.riskLevel === 'HIGH' || output.riskLevel === 'CRITICAL')) {
      const message = `${row.code} ${row.produce.toLowerCase()} is ${output.riskLevel}: ~${output.remainingHours.toFixed(1)} h of shelf life left against ${transitRemaining.toFixed(1)} h of transit. ${decision.retailerAction}`;
      db.prepare(
        `INSERT INTO spoilage_alerts (id, shipment_id, snapshot_id, severity, recipient, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), row.id, snapshotId, output.riskLevel, row.retailer, message, ts);
      audit(
        db,
        row.id,
        'RETAILER_ALERT_GENERATED',
        `${output.riskLevel} alert recorded for ${row.retailer}`,
        { severity: output.riskLevel, recipient: row.retailer },
        ts,
      );
    }

    db.prepare(
      `UPDATE shipments SET transit_remaining_hours = ?, cumulative_equivalent_age_hours = ?, current_temperature_c = ?,
         current_humidity_pct = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      transitRemaining,
      output.cumulativeEquivalentAge,
      request.temperature,
      request.humidity,
      transitRemaining > 0 ? 'IN_TRANSIT' : 'ARRIVED',
      ts,
      row.id,
    );

    return toTelemetryView({
      id: telemetryId,
      shipment_id: row.id,
      temperature_c: request.temperature,
      humidity_pct: request.humidity,
      exposure_hours: request.transitDuration,
      recorded_at: ts,
    });
  });
}

/** Inserts a snapshot holding the full model decomposition. telemetryId is null only for the baseline. */
export function insertSnapshot(
  db: Db,
  shipmentId: string,
  telemetryId: string | null,
  output: ModelOutput,
  transitRemainingHours: number,
  ts: string,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO shelf_life_snapshots (id, shipment_id, telemetry_event_id, model_version, temperature_c, humidity_pct,
       exposure_hours, temperature_stress, humidity_factor, equivalent_age_increment, cumulative_equivalent_age,
       remaining_hours, transit_remaining_hours, risk_level, explanation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    shipmentId,
    telemetryId,
    output.modelVersion,
    output.temperatureC,
    output.humidityPct,
    output.exposureHours,
    output.temperatureStress,
    output.humidityFactor,
    output.equivalentAgeIncrement,
    output.cumulativeEquivalentAge,
    output.remainingHours,
    transitRemainingHours,
    output.riskLevel,
    output.explanation,
    ts,
  );
  return id;
}

export function audit(db: Db, shipmentId: string, eventType: string, summary: string, detail: unknown, ts: string) {
  db.prepare(
    'INSERT INTO audit_logs (id, shipment_id, event_type, summary, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(randomUUID(), shipmentId, eventType, summary, JSON.stringify(detail), ts);
}

export interface SnapshotView {
  remainingHours: number;
  transitRemainingHours: number;
  temperatureC: number;
  humidityPct: number;
  exposureHours: number;
  equivalentAgeIncrement: number;
  riskLevel: RiskLevel;
  createdAt: string;
}

/** Runs one engine step. Any failure becomes an EngineError, so the API can report it without internals. */
function engineStep<T>(name: string, step: () => T): T {
  try {
    return step();
  } catch {
    throw new EngineError(`${name} failed`);
  }
}
