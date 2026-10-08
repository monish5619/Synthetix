import { randomUUID } from 'node:crypto';
import type { TelemetryPayload } from '../shared/scenarios.js';
import { inTransaction, type Db } from './db.js';
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

export class NotFoundError extends Error {}

interface ShipmentRow {
  id: string;
  code: string;
  produce: string;
  origin: string;
  destination: string;
  retailer: string;
  quantity_kg: number;
  base_price_per_kg: number;
  reference_temp_c: number;
  reference_humidity_pct: number;
  reference_shelf_life_hours: number;
  q10: number;
  transit_total_hours: number;
  transit_remaining_hours: number;
  equivalent_age_hours: number;
  last_temperature_c: number;
  last_humidity_pct: number;
  remaining_shelf_life_hours: number;
  margin: number;
  risk_level: RiskLevel;
  created_at: string;
  updated_at: string;
}

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

interface ListingRow {
  basePricePerKg: number;
  currentPricePerKg: number;
  discountPct: number;
  status: string;
  updatedAt: string;
}

interface AlertRow {
  id: string;
  severity: RiskLevel;
  recipient: string;
  message: string;
  createdAt: string;
}

interface RecommendationRow {
  id: string;
  markdownPct: number;
  originalPricePerKg: number;
  liquidationPricePerKg: number;
  sellByHours: number;
  rationale: string;
  status: string;
  createdAt: string;
}

interface TelemetryRow {
  id: string;
  temperatureC: number;
  humidityPct: number;
  intervalHours: number;
  source: string;
  recordedAt: string;
}

interface AuditRow {
  id: string;
  eventType: string;
  summary: string;
  detailJson: string;
  createdAt: string;
}

export interface ShipmentState {
  shipment: {
    id: string;
    code: string;
    produce: string;
    origin: string;
    destination: string;
    retailer: string;
    quantityKg: number;
    basePricePerKg: number;
    transitTotalHours: number;
    profile: ProductProfile;
    updatedAt: string;
  };
  current: Assessment;
  listing: ListingRow;
  recommendations: RecommendationRow[];
  alerts: AlertRow[];
  telemetry: TelemetryRow[];
  audit: AuditRow[];
}

const now = () => new Date().toISOString();

export function getShipmentRow(db: Db, shipmentId: string): ShipmentRow {
  const row = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId) as ShipmentRow | undefined;
  if (!row) throw new NotFoundError('Shipment not found.');
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

/**
 * Telemetry pipeline, run atomically:
 * validate → persist reading → recalculate degradation → snapshot →
 * liquidation recommendation + marketplace update → spoilage alert → audit.
 * Expects an already-validated payload.
 */
export function ingestTelemetry(db: Db, shipmentId: string, reading: TelemetryPayload) {
  return inTransaction(db, () => {
    const row = getShipmentRow(db, shipmentId);
    const profile = profileOf(row);
    const ts = now();

    const next = applyInterval(
      profile,
      { equivalentAgeHours: row.equivalent_age_hours, transitRemainingHours: row.transit_remaining_hours },
      reading,
      reading.intervalHours,
    );
    const a = assess(profile, next, reading);

    const telemetryId = randomUUID();
    db.prepare(
      `INSERT INTO telemetry_events (id, shipment_id, recorded_at, temperature_c, humidity_pct, interval_hours, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(telemetryId, shipmentId, ts, reading.temperatureC, reading.humidityPct, reading.intervalHours, reading.source, ts);

    const snapshotId = randomUUID();
    db.prepare(
      `INSERT INTO shelf_life_snapshots (id, shipment_id, telemetry_event_id, thermal_multiplier, humidity_multiplier,
        age_rate, equivalent_age_hours, remaining_equivalent_hours, remaining_shelf_life_hours,
        transit_remaining_hours, margin, risk_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshotId,
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

    audit(db, shipmentId, 'TELEMETRY_RECEIVED', `${reading.source} reading ${reading.temperatureC} °C / ${reading.humidityPct} % RH over ${reading.intervalHours} h`, {
      telemetryId,
      ...reading,
    }, ts);
    audit(db, shipmentId, 'SHELF_LIFE_RECALCULATED', `Remaining shelf life ${fmt(a.remainingShelfLifeHours)} h · margin ${fmt(a.margin)}× · risk ${a.riskLevel}`, {
      snapshotId,
      thermalMultiplier: a.thermalMultiplier,
      humidityMultiplier: a.humidityMultiplier,
      ageRate: a.ageRate,
      equivalentAgeHours: a.equivalentAgeHours,
      remainingShelfLifeHours: a.remainingShelfLifeHours,
      transitRemainingHours: a.transitRemainingHours,
      margin: a.margin,
      riskLevel: a.riskLevel,
    }, ts);

    if (requiresLiquidation(a.riskLevel)) {
      const listing = db
        .prepare('SELECT * FROM marketplace_listings WHERE shipment_id = ?')
        .get(shipmentId) as { discount_pct: number } | undefined;
      const previousDiscount = listing?.discount_pct ?? 0;
      // Discounts only deepen: a later normal reading never raises the price back.
      const markdown = Math.max(previousDiscount, liquidationMarkdownPct(a.margin));

      if (markdown > previousDiscount) {
        const newPrice = discountedPrice(row.base_price_per_kg, markdown);
        db.prepare(
          `UPDATE marketplace_listings SET current_price_per_kg = ?, discount_pct = ?, status = 'LIQUIDATION', updated_at = ?
           WHERE shipment_id = ?`,
        ).run(newPrice, markdown, ts, shipmentId);

        const sellBy = Math.max(0, Math.floor(a.remainingShelfLifeHours));
        db.prepare(
          `INSERT INTO liquidation_recommendations (id, shipment_id, snapshot_id, markdown_pct, original_price_per_kg,
            liquidation_price_per_kg, sell_by_hours, rationale, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?)`,
        ).run(
          randomUUID(),
          shipmentId,
          snapshotId,
          markdown,
          row.base_price_per_kg,
          newPrice,
          sellBy,
          `Margin ${fmt(a.margin)}× is below the 1.25× liquidation threshold: ${fmt(a.remainingShelfLifeHours)} h of shelf life against ${fmt(a.transitRemainingHours)} h of transit.`,
          ts,
        );
        audit(db, shipmentId, 'LIQUIDATION_RECOMMENDED', `${markdown}% markdown recommended: ₹${row.base_price_per_kg}/kg → ₹${newPrice}/kg`, {
          markdownPct: markdown,
          liquidationPricePerKg: newPrice,
          sellByHours: sellBy,
        }, ts);
        audit(db, shipmentId, 'MARKETPLACE_LISTING_UPDATED', `Listing repriced to ₹${newPrice}/kg (${markdown}% off)`, {
          currentPricePerKg: newPrice,
          discountPct: markdown,
        }, ts);
      }
    }

    const previousRisk = row.risk_level;
    if (
      RISK_RANK[a.riskLevel] > RISK_RANK[previousRisk] &&
      (a.riskLevel === 'HIGH' || a.riskLevel === 'CRITICAL')
    ) {
      const message = `${row.code} ${row.produce.toLowerCase()} risk ${a.riskLevel}: ~${fmt(a.remainingShelfLifeHours)} h shelf life left against ${fmt(a.transitRemainingHours)} h transit. Liquidation pricing is live.`;
      db.prepare(
        `INSERT INTO spoilage_alerts (id, shipment_id, severity, recipient, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), shipmentId, a.riskLevel, row.retailer, message, ts);
      audit(db, shipmentId, 'SPOILAGE_ALERT_RAISED', `${a.riskLevel} alert sent to ${row.retailer}`, { severity: a.riskLevel }, ts);
    }

    db.prepare(
      `UPDATE shipments SET transit_remaining_hours = ?, equivalent_age_hours = ?, last_temperature_c = ?,
        last_humidity_pct = ?, remaining_shelf_life_hours = ?, margin = ?, risk_level = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      a.transitRemainingHours,
      a.equivalentAgeHours,
      reading.temperatureC,
      reading.humidityPct,
      a.remainingShelfLifeHours,
      a.margin,
      a.riskLevel,
      ts,
      shipmentId,
    );

    return { telemetryId, snapshotId };
  });
}

function audit(db: Db, shipmentId: string, eventType: string, summary: string, detail: unknown, ts: string) {
  db.prepare(
    `INSERT INTO audit_logs (id, shipment_id, event_type, summary, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), shipmentId, eventType, summary, JSON.stringify(detail), ts);
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/** Full dashboard state, read straight from the database. */
export function getShipmentState(db: Db, shipmentId: string): ShipmentState {
  const row = getShipmentRow(db, shipmentId);
  const profile = profileOf(row);
  const latest = db
    .prepare('SELECT * FROM telemetry_events WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(shipmentId) as { temperature_c: number; humidity_pct: number } | undefined;
  const current = assess(
    profile,
    { equivalentAgeHours: row.equivalent_age_hours, transitRemainingHours: row.transit_remaining_hours },
    latest
      ? { temperatureC: latest.temperature_c, humidityPct: latest.humidity_pct }
      : { temperatureC: row.last_temperature_c, humidityPct: row.last_humidity_pct },
  );

  return {
    shipment: {
      id: row.id,
      code: row.code,
      produce: row.produce,
      origin: row.origin,
      destination: row.destination,
      retailer: row.retailer,
      quantityKg: row.quantity_kg,
      basePricePerKg: row.base_price_per_kg,
      transitTotalHours: row.transit_total_hours,
      profile,
      updatedAt: row.updated_at,
    },
    current,
    listing: db
      .prepare(
        `SELECT base_price_per_kg AS basePricePerKg, current_price_per_kg AS currentPricePerKg,
           discount_pct AS discountPct, status, updated_at AS updatedAt
         FROM marketplace_listings WHERE shipment_id = ?`,
      )
      .get(shipmentId) as unknown as ListingRow,
    recommendations: db
      .prepare(
        `SELECT id, markdown_pct AS markdownPct, original_price_per_kg AS originalPricePerKg,
           liquidation_price_per_kg AS liquidationPricePerKg, sell_by_hours AS sellByHours,
           rationale, status, created_at AS createdAt
         FROM liquidation_recommendations WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10`,
      )
      .all(shipmentId) as unknown as RecommendationRow[],
    alerts: db
      .prepare(
        `SELECT id, severity, recipient, message, created_at AS createdAt
         FROM spoilage_alerts WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10`,
      )
      .all(shipmentId) as unknown as AlertRow[],
    telemetry: db
      .prepare(
        `SELECT id, temperature_c AS temperatureC, humidity_pct AS humidityPct, interval_hours AS intervalHours,
           source, created_at AS recordedAt
         FROM telemetry_events WHERE shipment_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(shipmentId) as unknown as TelemetryRow[],
    audit: db
      .prepare(
        `SELECT id, event_type AS eventType, summary, detail_json AS detailJson, created_at AS createdAt
         FROM audit_logs WHERE shipment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 40`,
      )
      .all(shipmentId) as unknown as AuditRow[],
  };
}
