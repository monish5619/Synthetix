import { randomUUID } from 'node:crypto';
import { inTransaction, type Db } from './db.js';
import { notFound } from './errors.js';
import {
  applyInterval,
  assess,
  discountedPrice,
  liquidationMarkdownPct,
  requiresLiquidation,
  type Assessment,
  type ProductProfile,
  type RiskLevel,
} from './model.js';
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
  reference_temp_c: number;
  reference_humidity_pct: number;
  reference_shelf_life_hours: number;
  q10: number;
  transit_total_hours: number;
  transit_remaining_hours: number;
  equivalent_age_hours: number;
  current_temperature_c: number;
  current_humidity_pct: number;
  created_at: string;
  updated_at: string;
}

interface TelemetryRow {
  id: string;
  shipment_id: string;
  temperature_c: number;
  humidity_pct: number;
  transit_duration_hours: number;
  recorded_at: string;
}

export interface RecommendationView {
  id: string;
  markdownPct: number;
  originalPricePerKg: number;
  liquidationPricePerKg: number;
  sellByHours: number;
  rationale: string;
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

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/* ---------- reads ---------- */

export function getShipmentRow(db: Db, shipmentId: string): ShipmentRow {
  const row = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId) as ShipmentRow | undefined;
  if (!row) throw notFound('Shipment not found.');
  return row;
}

function profileOf(row: ShipmentRow): ProductProfile {
  return {
    produce: row.produce,
    referenceTempC: row.reference_temp_c,
    referenceHumidityPct: row.reference_humidity_pct,
    referenceShelfLifeHours: row.reference_shelf_life_hours,
    q10: row.q10,
  };
}

/** Derived from the shipment's stored state. Never stored a second time. */
function currentAssessment(row: ShipmentRow): Assessment {
  return assess(
    profileOf(row),
    { equivalentAgeHours: row.equivalent_age_hours, transitRemainingHours: row.transit_remaining_hours },
    { temperatureC: row.current_temperature_c, humidityPct: row.current_humidity_pct },
  );
}

function latestRisk(db: Db, shipmentId: string): RiskLevel {
  const row = db
    .prepare(
      'SELECT risk_level FROM shelf_life_snapshots WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    )
    .get(shipmentId) as { risk_level: RiskLevel } | undefined;
  return row?.risk_level ?? 'LOW';
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
  remainingShelfLifeHours: number;
  riskLevel: RiskLevel;
  currentPricePerKg: number;
}

export function listShipments(db: Db): ShipmentSummary[] {
  const rows = db
    .prepare('SELECT * FROM shipments ORDER BY created_at ASC, rowid ASC')
    .all() as unknown as ShipmentRow[];
  return rows.map((row) => {
    const a = currentAssessment(row);
    return {
      id: row.id,
      code: row.code,
      produce: row.produce,
      status: row.status,
      currentTemperature: row.current_temperature_c,
      currentHumidity: row.current_humidity_pct,
      remainingShelfLifeHours: a.remainingShelfLifeHours,
      riskLevel: a.riskLevel,
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
    transitDuration: row.transit_duration_hours,
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
  const current = currentAssessment(row);
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
      transitTotalHours: row.transit_total_hours,
      profile: profileOf(row),
      updatedAt: row.updated_at,
    },
    current: {
      temperature: row.current_temperature_c,
      humidity: row.current_humidity_pct,
      ...current,
    },
    listing: {
      basePricePerKg: row.original_price_per_kg,
      ...listing,
    },
    recommendations: db
      .prepare(
        `SELECT id, markdown_pct AS markdownPct, original_price_per_kg AS originalPricePerKg,
           liquidation_price_per_kg AS liquidationPricePerKg, sell_by_hours AS sellByHours,
           rationale, status, created_at AS createdAt
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
    audit: db
      .prepare(
        `SELECT id, event_type AS eventType, summary, detail_json AS detailJson, created_at AS createdAt
         FROM audit_logs WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 40`,
      )
      .all(shipmentId) as unknown as AuditView[],
  };
}

export type ShipmentDetail = ReturnType<typeof getShipmentDetail>;

/* ---------- writes ---------- */

const now = () => new Date().toISOString();

/**
 * Telemetry pipeline, one transaction. Any failure rolls back every write.
 * Steps: persist event → recalculate degradation → snapshot → liquidation and
 * marketplace update → spoilage alert → shipment state → audit.
 * Input must already be validated.
 */
export function ingestTelemetry(db: Db, request: TelemetryRequest): TelemetryEventView {
  return inTransaction(db, () => {
    const row = getShipmentRow(db, request.shipmentId);
    const profile = profileOf(row);
    const ts = now();
    const measured = { temperatureC: request.temperature, humidityPct: request.humidity };

    const next = applyInterval(
      profile,
      { equivalentAgeHours: row.equivalent_age_hours, transitRemainingHours: row.transit_remaining_hours },
      measured,
      request.transitDuration,
    );
    const a = assess(profile, next, measured);
    const previousRisk = latestRisk(db, row.id);

    const telemetryId = randomUUID();
    db.prepare(
      `INSERT INTO telemetry_events (id, shipment_id, temperature_c, humidity_pct, transit_duration_hours, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(telemetryId, row.id, request.temperature, request.humidity, request.transitDuration, ts);

    const snapshotId = insertSnapshot(db, row.id, telemetryId, a, ts);
    audit(
      db,
      row.id,
      'TELEMETRY_RECEIVED',
      `Reading ${request.temperature} °C / ${request.humidity} % RH after ${request.transitDuration} h`,
      { telemetryId, temperature: request.temperature, humidity: request.humidity, transitDuration: request.transitDuration },
      ts,
    );
    audit(
      db,
      row.id,
      'SHELF_LIFE_RECALCULATED',
      `Remaining shelf life ${fmt(a.remainingShelfLifeHours)} h · cover ${fmt(a.margin)}× · risk ${a.riskLevel}`,
      {
        snapshotId,
        thermalMultiplier: a.thermalMultiplier,
        humidityMultiplier: a.humidityMultiplier,
        ageRate: a.ageRate,
        equivalentAgeHours: a.equivalentAgeHours,
        remainingShelfLifeHours: a.remainingShelfLifeHours,
        transitRemainingHours: a.transitRemainingHours,
        margin: a.margin,
        riskLevel: a.riskLevel,
      },
      ts,
    );

    if (requiresLiquidation(a.riskLevel)) liquidate(db, row, snapshotId, a, ts);

    // Alert only on escalation into HIGH or CRITICAL, so repeat readings don't spam.
    if (RISK_RANK[a.riskLevel] > RISK_RANK[previousRisk] && requiresLiquidation(a.riskLevel)) {
      const message = `${row.code} ${row.produce.toLowerCase()} risk ${a.riskLevel}: ~${fmt(a.remainingShelfLifeHours)} h shelf life left against ${fmt(a.transitRemainingHours)} h transit. Liquidation pricing is live.`;
      db.prepare(
        `INSERT INTO spoilage_alerts (id, shipment_id, snapshot_id, severity, recipient, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), row.id, snapshotId, a.riskLevel, row.retailer, message, ts);
      audit(db, row.id, 'SPOILAGE_ALERT_RAISED', `${a.riskLevel} alert sent to ${row.retailer}`, { severity: a.riskLevel }, ts);
    }

    db.prepare(
      `UPDATE shipments SET transit_remaining_hours = ?, equivalent_age_hours = ?, current_temperature_c = ?,
         current_humidity_pct = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      a.transitRemainingHours,
      a.equivalentAgeHours,
      request.temperature,
      request.humidity,
      a.transitRemainingHours > 0 ? 'IN_TRANSIT' : 'ARRIVED',
      ts,
      row.id,
    );

    return toTelemetryView({
      id: telemetryId,
      shipment_id: row.id,
      temperature_c: request.temperature,
      humidity_pct: request.humidity,
      transit_duration_hours: request.transitDuration,
      recorded_at: ts,
    });
  });
}

function liquidate(db: Db, row: ShipmentRow, snapshotId: string, a: Assessment, ts: string) {
  const listing = db
    .prepare('SELECT discount_pct FROM marketplace_listings WHERE shipment_id = ?')
    .get(row.id) as { discount_pct: number };
  // Discounts only deepen: a later normal reading never raises the price back.
  const markdown = Math.max(listing.discount_pct, liquidationMarkdownPct(a.margin));
  if (markdown <= listing.discount_pct) return;

  const newPrice = discountedPrice(row.original_price_per_kg, markdown);
  const sellBy = Math.max(0, Math.floor(a.remainingShelfLifeHours));
  db.prepare(
    `UPDATE marketplace_listings SET current_price_per_kg = ?, discount_pct = ?, status = 'LIQUIDATION', updated_at = ?
     WHERE shipment_id = ?`,
  ).run(newPrice, markdown, ts, row.id);

  db.prepare(
    `INSERT INTO liquidation_recommendations (id, shipment_id, snapshot_id, markdown_pct, original_price_per_kg,
       liquidation_price_per_kg, sell_by_hours, rationale, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?)`,
  ).run(
    randomUUID(),
    row.id,
    snapshotId,
    markdown,
    row.original_price_per_kg,
    newPrice,
    sellBy,
    `Cover ${fmt(a.margin)}× is below the 1.25× liquidation threshold: ${fmt(a.remainingShelfLifeHours)} h of shelf life against ${fmt(a.transitRemainingHours)} h of transit.`,
    ts,
  );
  audit(db, row.id, 'LIQUIDATION_RECOMMENDED', `${markdown}% markdown: ₹${row.original_price_per_kg}/kg → ₹${newPrice}/kg`, {
    markdownPct: markdown,
    liquidationPricePerKg: newPrice,
    sellByHours: sellBy,
  }, ts);
  audit(db, row.id, 'MARKETPLACE_LISTING_UPDATED', `Listing repriced to ₹${newPrice}/kg (${markdown}% off)`, {
    currentPricePerKg: newPrice,
    discountPct: markdown,
  }, ts);
}

/** Inserts a snapshot. telemetryId is null only for the baseline snapshot. */
export function insertSnapshot(db: Db, shipmentId: string, telemetryId: string | null, a: Assessment, ts: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO shelf_life_snapshots (id, shipment_id, telemetry_event_id, thermal_multiplier, humidity_multiplier,
       age_rate, equivalent_age_hours, remaining_equivalent_hours, remaining_shelf_life_hours,
       transit_remaining_hours, margin, risk_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    shipmentId,
    telemetryId,
    a.thermalMultiplier,
    a.humidityMultiplier,
    a.ageRate,
    a.equivalentAgeHours,
    a.remainingEquivalentHours,
    a.remainingShelfLifeHours,
    a.transitRemainingHours,
    a.margin,
    a.riskLevel,
    ts,
  );
  return id;
}

export function audit(db: Db, shipmentId: string, eventType: string, summary: string, detail: unknown, ts: string) {
  db.prepare(
    'INSERT INTO audit_logs (id, shipment_id, event_type, summary, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(randomUUID(), shipmentId, eventType, summary, JSON.stringify(detail), ts);
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
