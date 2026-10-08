/**
 * Read models for the secondary screens: marketplace, alerts, and telemetry history.
 * Every value comes from stored rows. Nothing here is computed for display only,
 * except the classification and the recommended-action wording, which are deterministic.
 */
import { EXCURSION_ABOVE_IDEAL_C, MODEL_CONFIG, type RiskLevel, type Urgency } from './config.js';
import type { Db } from './db.js';
import { classifyRisk } from './model.js';
import { notFound } from './errors.js';
import { inTransaction } from './db.js';
import { audit } from './pipeline.js';

const URGENCY_OF = (value: string | null): Urgency | 'NONE' => (value as Urgency | null) ?? 'NONE';

export interface MarketplaceRow {
  listingId: string;
  shipmentId: string;
  code: string;
  produce: string;
  origin: string;
  destination: string;
  remainingHours: number;
  riskLevel: RiskLevel;
  originalPricePerKg: number;
  currentPricePerKg: number;
  discountPct: number;
  listingStatus: string;
  availableKg: number;
  urgency: Urgency | 'NONE';
  updatedAt: string;
}

export function listMarketplace(db: Db): MarketplaceRow[] {
  const rows = db
    .prepare(
      `SELECT l.id AS listingId, s.id AS shipmentId, s.code, s.produce, s.origin, s.destination,
         s.baseline_shelf_life_hours AS baseline, s.cumulative_equivalent_age_hours AS cumulative,
         s.original_price_per_kg AS originalPricePerKg, s.quantity_kg AS availableKg,
         l.current_price_per_kg AS currentPricePerKg, l.discount_pct AS discountPct, l.status AS listingStatus,
         l.updated_at AS updatedAt,
         (SELECT r.urgency FROM liquidation_recommendations r WHERE r.shipment_id = s.id
            ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS urgency
       FROM marketplace_listings l JOIN shipments s ON s.id = l.shipment_id
       ORDER BY s.created_at ASC, s.rowid ASC`,
    )
    .all() as unknown as Array<Record<string, number | string | null>>;

  return rows.map((r) => {
    const remainingHours = Math.max(0, (r.baseline as number) - (r.cumulative as number));
    return {
      listingId: r.listingId as string,
      shipmentId: r.shipmentId as string,
      code: r.code as string,
      produce: r.produce as string,
      origin: r.origin as string,
      destination: r.destination as string,
      remainingHours,
      riskLevel: classifyRisk(remainingHours),
      originalPricePerKg: r.originalPricePerKg as number,
      currentPricePerKg: r.currentPricePerKg as number,
      discountPct: r.discountPct as number,
      listingStatus: r.listingStatus as string,
      availableKg: r.availableKg as number,
      urgency: URGENCY_OF(r.urgency as string | null),
      updatedAt: r.updatedAt as string,
    };
  });
}

export interface AlertView {
  id: string;
  shipmentId: string;
  code: string;
  produce: string;
  severity: RiskLevel;
  remainingHours: number;
  markdownPct: number | null;
  recommendedPricePerKg: number | null;
  recommendedAction: string;
  recipient: string;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export function listAlerts(db: Db): AlertView[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.shipment_id AS shipmentId, s.code, s.produce, a.severity, a.recipient, a.message, a.created_at AS createdAt, a.acknowledged_at AS acknowledgedAt,
         sn.remaining_hours AS remainingHours,
         r.markdown_pct AS markdownPct, r.recommended_price_per_kg AS recommendedPricePerKg
       FROM spoilage_alerts a
         JOIN shipments s ON s.id = a.shipment_id
         JOIN shelf_life_snapshots sn ON sn.id = a.snapshot_id
         LEFT JOIN liquidation_recommendations r ON r.snapshot_id = a.snapshot_id
       ORDER BY a.created_at DESC, a.rowid DESC`,
    )
    .all() as unknown as Array<Record<string, number | string | null>>;

  return rows.map((r) => {
    const markdownPct = (r.markdownPct as number | null) ?? null;
    return {
      id: r.id as string,
      shipmentId: r.shipmentId as string,
      code: r.code as string,
      produce: r.produce as string,
      severity: r.severity as RiskLevel,
      remainingHours: r.remainingHours as number,
      markdownPct,
      recommendedPricePerKg: (r.recommendedPricePerKg as number | null) ?? null,
      recommendedAction:
        markdownPct !== null
          ? `Liquidate to local retailers at ${markdownPct}% markdown`
          : 'Prepare retailer outreach for sale within the remaining shelf life',
      recipient: r.recipient as string,
      message: r.message as string,
      createdAt: r.createdAt as string,
      acknowledgedAt: (r.acknowledgedAt as string | null) ?? null,
    };
  });
}

export type TelemetryKind = 'NORMAL_TELEMETRY' | 'THERMAL_EXCURSION';

export interface TelemetryHistoryEntry {
  id: string;
  recordedAt: string;
  kind: TelemetryKind;
  temperature: number;
  humidity: number;
  exposureHours: number;
  remainingHours: number | null;
  riskLevel: RiskLevel | null;
  explanation: string | null;
}

/** Telemetry events joined to the snapshot each one produced, oldest first. */
export function telemetryHistory(db: Db, shipmentId: string): TelemetryHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.recorded_at AS recordedAt, t.temperature_c AS temperature, t.humidity_pct AS humidity,
         t.exposure_hours AS exposureHours, sn.remaining_hours AS remainingHours, sn.risk_level AS riskLevel,
         sn.explanation AS explanation
       FROM telemetry_events t
         LEFT JOIN shelf_life_snapshots sn ON sn.telemetry_event_id = t.id
       WHERE t.shipment_id = ?
       ORDER BY t.recorded_at ASC, t.rowid ASC`,
    )
    .all(shipmentId) as unknown as Array<Record<string, number | string | null>>;

  return rows.map((r) => ({
    id: r.id as string,
    recordedAt: r.recordedAt as string,
    kind: (r.temperature as number) > MODEL_CONFIG.idealTemperatureC + EXCURSION_ABOVE_IDEAL_C
      ? 'THERMAL_EXCURSION'
      : 'NORMAL_TELEMETRY',
    temperature: r.temperature as number,
    humidity: r.humidity as number,
    exposureHours: r.exposureHours as number,
    remainingHours: (r.remainingHours as number | null) ?? null,
    riskLevel: (r.riskLevel as RiskLevel | null) ?? null,
    explanation: (r.explanation as string | null) ?? null,
  }));
}

/**
 * Records that the retailer has seen and accepted the alert. Acknowledging twice is safe:
 * the first acknowledgement time is kept. The change and its audit event commit together.
 */
export function acknowledgeAlert(db: Db, alertId: string): AlertView {
  return inTransaction(db, () => {
    const row = db
      .prepare('SELECT shipment_id AS shipmentId, acknowledged_at AS acknowledgedAt FROM spoilage_alerts WHERE id = ?')
      .get(alertId) as { shipmentId: string; acknowledgedAt: string | null } | undefined;
    if (!row) throw notFound('Alert not found.');

    if (row.acknowledgedAt === null) {
      const ts = new Date().toISOString();
      db.prepare('UPDATE spoilage_alerts SET acknowledged_at = ? WHERE id = ?').run(ts, alertId);
      audit(db, row.shipmentId, 'RETAILER_ACKNOWLEDGED', 'Retailer acknowledged the spoilage alert', { alertId }, ts);
    }
    return listAlerts(db).find((a) => a.id === alertId) as AlertView;
  });
}
