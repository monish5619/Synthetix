import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  produce TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  retailer TEXT NOT NULL,
  quantity_kg REAL NOT NULL,
  base_price_per_kg REAL NOT NULL,
  reference_temp_c REAL NOT NULL,
  reference_humidity_pct REAL NOT NULL,
  reference_shelf_life_hours REAL NOT NULL,
  q10 REAL NOT NULL,
  transit_total_hours REAL NOT NULL,
  transit_remaining_hours REAL NOT NULL,
  equivalent_age_hours REAL NOT NULL,
  last_temperature_c REAL NOT NULL,
  last_humidity_pct REAL NOT NULL,
  remaining_shelf_life_hours REAL NOT NULL,
  margin REAL NOT NULL,
  risk_level TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  temperature_c REAL NOT NULL,
  humidity_pct REAL NOT NULL,
  interval_hours REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shelf_life_snapshots (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  telemetry_event_id TEXT REFERENCES telemetry_events(id) ON DELETE CASCADE,
  thermal_multiplier REAL NOT NULL,
  humidity_multiplier REAL NOT NULL,
  age_rate REAL NOT NULL,
  equivalent_age_hours REAL NOT NULL,
  remaining_equivalent_hours REAL NOT NULL,
  remaining_shelf_life_hours REAL NOT NULL,
  transit_remaining_hours REAL NOT NULL,
  margin REAL NOT NULL,
  risk_level TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
  base_price_per_kg REAL NOT NULL,
  current_price_per_kg REAL NOT NULL,
  discount_pct INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS liquidation_recommendations (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES shelf_life_snapshots(id) ON DELETE CASCADE,
  markdown_pct INTEGER NOT NULL,
  original_price_per_kg REAL NOT NULL,
  liquidation_price_per_kg REAL NOT NULL,
  sell_by_hours REAL NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spoilage_alerts (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_shipment ON telemetry_events(shipment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_shipment ON audit_logs(shipment_id, created_at);
`;

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside a transaction; rolls back on any thrown error. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
