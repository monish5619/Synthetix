import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Bump SCHEMA_VERSION whenever the schema changes. A database with an older
 * version is rebuilt from scratch: this is pre-release demo data, so there is
 * no migration path to preserve.
 */
export const SCHEMA_VERSION = 5;

const TABLES = [
  'idempotency_keys',
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
  baseline_shelf_life_hours REAL NOT NULL CHECK (baseline_shelf_life_hours > 0),
  transit_total_hours REAL NOT NULL CHECK (transit_total_hours >= 0),
  -- Current state. Remaining shelf life is derived from cumulative_equivalent_age_hours.
  transit_remaining_hours REAL NOT NULL CHECK (transit_remaining_hours >= 0),
  cumulative_equivalent_age_hours REAL NOT NULL CHECK (cumulative_equivalent_age_hours >= 0),
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
  exposure_hours REAL NOT NULL CHECK (exposure_hours >= 0),
  recorded_at TEXT NOT NULL
);

CREATE TABLE shelf_life_snapshots (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  -- NULL for the baseline snapshot created at shipment initialisation.
  telemetry_event_id TEXT UNIQUE REFERENCES telemetry_events(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  temperature_c REAL NOT NULL,
  humidity_pct REAL NOT NULL,
  exposure_hours REAL NOT NULL,
  temperature_stress REAL NOT NULL,
  humidity_factor REAL NOT NULL,
  equivalent_age_increment REAL NOT NULL,
  cumulative_equivalent_age REAL NOT NULL,
  remaining_hours REAL NOT NULL,
  transit_remaining_hours REAL NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('NORMAL', 'WATCH', 'HIGH', 'CRITICAL')),
  explanation TEXT NOT NULL,
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
  risk_level TEXT NOT NULL CHECK (risk_level IN ('NORMAL', 'WATCH', 'HIGH', 'CRITICAL')),
  markdown_pct INTEGER NOT NULL CHECK (markdown_pct BETWEEN 1 AND 60),
  original_price_per_kg REAL NOT NULL,
  recommended_price_per_kg REAL NOT NULL,
  sell_by_hours INTEGER NOT NULL CHECK (sell_by_hours >= 0),
  urgency TEXT NOT NULL CHECK (urgency IN ('MONITOR', 'PRIORITY', 'IMMEDIATE')),
  reason TEXT NOT NULL,
  retailer_action TEXT NOT NULL,
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
  created_at TEXT NOT NULL,
  -- Set when the retailer acknowledges the alert. NULL means still open.
  acknowledged_at TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Idempotency: a repeated request with the same key returns the stored response.
CREATE TABLE idempotency_keys (
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, scope)
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

/** Nesting depth per connection. Inner calls use savepoints, so a failure rolls back only its own work. */
const depth = new WeakMap<Db, number>();

/**
 * Runs fn in a transaction. If one is already open on this connection, fn runs in a
 * savepoint instead. Any thrown error rolls back everything fn wrote.
 */
export function inTransaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;
  if (level === 0) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    depth.set(db, level);
    if (level === 0) db.exec('COMMIT');
    else db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    depth.set(db, level);
    if (level === 0) db.exec('ROLLBACK');
    else db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  }
}
