import { randomUUID } from 'node:crypto';
import { inTransaction, type Db } from './db.js';
import { DEMO_SHIPMENT } from './demo.js';
import { assess, discountedPrice } from './model.js';
import { audit, insertSnapshot } from './pipeline.js';

const now = () => new Date().toISOString();

/** Ensures the demo shipment exists in the database. Idempotent. Returns its id. */
export function seedDemoShipment(db: Db): string {
  const existing = db.prepare('SELECT id FROM shipments WHERE code = ?').get(DEMO_SHIPMENT.code) as
    | { id: string }
    | undefined;
  return existing ? existing.id : resetDemoShipment(db);
}

/**
 * Rebuilds the demo shipment at its initial state. Keeps the same id when it
 * already exists, and deletes its prior telemetry, snapshots, listing and audit
 * trail (ON DELETE CASCADE), so the workflow can be replayed.
 */
export function resetDemoShipment(db: Db): string {
  return inTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM shipments WHERE code = ?').get(DEMO_SHIPMENT.code) as
      | { id: string }
      | undefined;
    const id = existing?.id ?? randomUUID();
    if (existing) db.prepare('DELETE FROM shipments WHERE id = ?').run(id);

    const ts = now();
    const { profile } = DEMO_SHIPMENT;
    const initial = { temperatureC: DEMO_SHIPMENT.initialTemperatureC, humidityPct: DEMO_SHIPMENT.initialHumidityPct };
    const baseline = { equivalentAgeHours: 0, transitRemainingHours: DEMO_SHIPMENT.transitHours };
    const a = assess(profile, baseline, initial);

    db.prepare(
      `INSERT INTO shipments (id, code, produce, origin, destination, retailer, status, quantity_kg, original_price_per_kg,
        reference_temp_c, reference_humidity_pct, reference_shelf_life_hours, q10,
        transit_total_hours, transit_remaining_hours, equivalent_age_hours,
        current_temperature_c, current_humidity_pct, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_TRANSIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      DEMO_SHIPMENT.code,
      DEMO_SHIPMENT.produce,
      DEMO_SHIPMENT.origin,
      DEMO_SHIPMENT.destination,
      DEMO_SHIPMENT.retailer,
      DEMO_SHIPMENT.quantityKg,
      DEMO_SHIPMENT.originalPricePerKg,
      profile.referenceTempC,
      profile.referenceHumidityPct,
      profile.referenceShelfLifeHours,
      profile.q10,
      DEMO_SHIPMENT.transitHours,
      baseline.transitRemainingHours,
      baseline.equivalentAgeHours,
      initial.temperatureC,
      initial.humidityPct,
      ts,
      ts,
    );

    db.prepare(
      `INSERT INTO marketplace_listings (id, shipment_id, current_price_per_kg, discount_pct, status, updated_at)
       VALUES (?, ?, ?, 0, 'NORMAL', ?)`,
    ).run(randomUUID(), id, discountedPrice(DEMO_SHIPMENT.originalPricePerKg, 0), ts);

    insertSnapshot(db, id, null, a, ts);

    audit(
      db,
      id,
      'SHIPMENT_INITIALIZED',
      `Shipment ${DEMO_SHIPMENT.code} initialised at ${initial.temperatureC} °C / ${initial.humidityPct} % RH`,
      { riskLevel: a.riskLevel, remainingShelfLifeHours: a.remainingShelfLifeHours },
      ts,
    );
    return id;
  });
}
