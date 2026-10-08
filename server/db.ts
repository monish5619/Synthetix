import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Bump SCHEMA_VERSION whenever the schema changes. A database with an older
 * version is rebuilt from scratch: this is pre-release demo data, so there is
 * no migration path to preserve.
 */
export const SCHEMA_VERSION = 2;

const TABLES = [
  'audit_logs',
  'spoilage_alerts',
  'liquidation_recommendations',
  'marketplace_listings',
  'shelf_life_snapshots',
  'telemetry_events',
  'shipments',
];

const SCHEMA = `
CREATE TABLE shipments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  produce TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  retailer TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_TRANSIT', 'ARRIVED')),
  quantity_kg REAL NOT NULL CHECK (quantity_kg > 0),
  original_price_per_kg REAL NOT NULL CHECK (original_price_per_kg > 0),
  reference_temp_c REAL NOT NULL,
  reference_humidity_pct REAL NOT NULL,
  reference_shelf_life_hours REAL NOT NULL CHECK (reference_shelf_life_hours > 0),
  q10 REAL NOT NULL CHECK (q10 > 1),
  transit_total_hours REAL NOT NULL CHECK (transit_total_hours >= 0),
  -- Current state: the only place these values live. Everything else derives from them.
  transit_remaining_hours REAL NOT NULL CHECK (transit_remaining_hours >= 0),
  equivalent_age_hours REAL NOT NULL CHECK (equivalent_age_hours >= 0),
  current_temperature_c REAL NOT NULL,
  current_humidity_pct REAL NOT NULL CHECK (current_humidity_pct BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE telemetry_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  temperature_c REAL NOT NULL,
  humidity_pct REAL NOT NULL CHECK (humidity_pct BETWEEN 0 AND 100),
  transit_duration_hours REAL NOT NULL CHECK (transit_duration_hours >= 0),
  recorded_at TEXT NOT NULL
);

CREATE TABLE shelf_life_snapshots (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  -- NULL for the baseline snapshot created at shipment initialisation.
  telemetry_event_id TEXT UNIQUE REFERENCES telemetry_events(id) ON DELETE CASCADE,
  thermal_multiplier REAL NOT NULL,
  humidity_multiplier REAL NOT NULL,
  age_rate REAL NOT NULL,
  equivalent_age_hours REAL NOT NULL,
  remaining_equivalent_hours REAL NOT NULL,
  remaining_shelf_life_hours REAL NOT NULL,
  transit_remaining_hours REAL NOT NULL,
  margin REAL NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  created_at TEXT NOT NULL
);

CREATE TABLE marketplace_listings (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
  current_price_per_kg REAL NOT NULL CHECK (current_price_per_kg > 0),
  discount_pct INTEGER NOT NULL CHECK (discount_pct BETWEEN 0 AND 60),
  status TEXT NOT NULL CHECK (status IN ('NORMAL', 'LIQUIDATION')),
  updated_at TEXT NOT NULL
);

CREATE TABLE liquidation_recommendations (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL UNIQUE REFERENCES shelf_life_snapshots(id) ON DELETE CASCADE,
  markdown_pct INTEGER NOT NULL CHECK (markdown_pct BETWEEN 1 AND 60),
  original_price_per_kg REAL NOT NULL,
  liquidation_price_per_kg REAL NOT NULL,
  sell_by_hours REAL NOT NULL CHECK (sell_by_hours >= 0),
  rationale TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPLIED')),
  created_at TEXT NOT NULL
);

CREATE TABLE spoilage_alerts (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL UNIQUE REFERENCES shelf_life_snapshots(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('HIGH', 'CRITICAL')),
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_telemetry_shipment ON telemetry_events(shipment_id, recorded_at);
CREATE INDEX idx_snapshots_shipment ON shelf_life_snapshots(shipment_id, created_at);
CREATE INDEX idx_recommendations_shipment ON liquidation_recommendations(shipment_id, created_at);
CREATE INDEX idx_alerts_shipment ON spoilage_alerts(shipment_id, created_at);
CREATE INDEX idx_audit_shipment ON audit_logs(shipment_id, created_at);
`;

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version === SCHEMA_VERSION) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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
