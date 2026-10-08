import { randomUUID } from 'node:crypto';
import { inTransaction, type Db } from './db.js';
import { DEMO_SHIPMENT } from './demo.js';
import { MODEL_CONFIG } from './config.js';
import { discountedPrice } from './liquidation.js';
import { evaluateExposure } from './model.js';
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
 * already exists. Prior telemetry, snapshots, listing, and audit are removed by
 * ON DELETE CASCADE, so the workflow can be replayed.
 */
export function resetDemoShipment(db: Db): string {
  return inTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM shipments WHERE code = ?').get(DEMO_SHIPMENT.code) as
      | { id: string }
      | undefined;
    // A fixed id, so every server instance agrees on the demo shipment's id.
    const id = existing?.id ?? DEMO_SHIPMENT.id;
    if (existing) db.prepare('DELETE FROM shipments WHERE id = ?').run(id);

    const ts = now();
    const initial = { temperatureC: DEMO_SHIPMENT.initialTemperatureC, humidityPct: DEMO_SHIPMENT.initialHumidityPct };

    // The baseline is the model evaluated with zero exposure, so it is recorded like any other run.
    const baseline = evaluateExposure({
      baselineShelfLifeHours: DEMO_SHIPMENT.baselineShelfLifeHours,
      cumulativeBefore: 0,
      exposure: { ...initial, exposureHours: 0 },
    });

    db.prepare(
      `INSERT INTO shipments (id, code, produce, origin, destination, retailer, status, quantity_kg, original_price_per_kg,
        baseline_shelf_life_hours, transit_total_hours, transit_remaining_hours, cumulative_equivalent_age_hours,
        current_temperature_c, current_humidity_pct, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_TRANSIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      DEMO_SHIPMENT.code,
      DEMO_SHIPMENT.produce,
      DEMO_SHIPMENT.origin,
      DEMO_SHIPMENT.destination,
      DEMO_SHIPMENT.retailer,
      DEMO_SHIPMENT.quantityKg,
      DEMO_SHIPMENT.originalPricePerKg,
      DEMO_SHIPMENT.baselineShelfLifeHours,
      DEMO_SHIPMENT.transitHours,
      DEMO_SHIPMENT.transitHours,
      baseline.cumulativeEquivalentAge,
      initial.temperatureC,
      initial.humidityPct,
      ts,
      ts,
    );

    db.prepare(
      `INSERT INTO marketplace_listings (id, shipment_id, current_price_per_kg, discount_pct, status, updated_at)
       VALUES (?, ?, ?, 0, 'NORMAL', ?)`,
    ).run(randomUUID(), id, discountedPrice(DEMO_SHIPMENT.originalPricePerKg, 0), ts);

    insertSnapshot(db, id, null, baseline, DEMO_SHIPMENT.transitHours, ts);
    audit(
      db,
      id,
      'SHIPMENT_INITIALIZED',
      `Shipment ${DEMO_SHIPMENT.code} initialised at ${initial.temperatureC} °C / ${initial.humidityPct} % RH (Q10 ${MODEL_CONFIG.q10})`,
      { riskLevel: baseline.riskLevel, remainingHours: baseline.remainingHours, modelVersion: baseline.modelVersion },
      ts,
    );
    return id;
  });
}
