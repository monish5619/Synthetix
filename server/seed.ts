import { randomUUID } from 'node:crypto';
import { inTransaction, type Db } from './db.js';
import { DEMO_SHIPMENT } from './demo.js';
import { assess, discountedPrice } from './model.js';

const now = () => new Date().toISOString();

/** Ensures the demo shipment exists. Idempotent. */
export function seedDemoShipment(db: Db): string {
  const existing = db.prepare('SELECT id FROM shipments WHERE code = ?').get(DEMO_SHIPMENT.code) as
    | { id: string }
    | undefined;
  return existing ? existing.id : resetDemoShipment(db);
}

/**
 * Rebuilds the demo shipment from its baseline. Deletes all prior state for that
 * shipment (telemetry, snapshots, listing, recommendations, alerts, audit) so the
 * workflow can be replayed from the initial state.
 */
export function resetDemoShipment(db: Db): string {
  return inTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM shipments WHERE code = ?').get(DEMO_SHIPMENT.code) as
      | { id: string }
      | undefined;
    // Keep the same id across resets so clients holding it stay valid.
    const id = existing?.id ?? randomUUID();
    if (existing) db.prepare('DELETE FROM shipments WHERE id = ?').run(id);

    const ts = now();
    const { profile } = DEMO_SHIPMENT;
    const baseline = { equivalentAgeHours: 0, transitRemainingHours: DEMO_SHIPMENT.transitHours };
    const reading = { temperatureC: DEMO_SHIPMENT.startTempC, humidityPct: DEMO_SHIPMENT.startHumidityPct };
    const a = assess(profile, baseline, reading);

    db.prepare(
      `INSERT INTO shipments (id, code, produce, origin, destination, retailer, quantity_kg, base_price_per_kg,
        reference_temp_c, reference_humidity_pct, reference_shelf_life_hours, q10,
        transit_total_hours, transit_remaining_hours, equivalent_age_hours,
        last_temperature_c, last_humidity_pct, remaining_shelf_life_hours, margin, risk_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      DEMO_SHIPMENT.code,
      DEMO_SHIPMENT.produce,
      DEMO_SHIPMENT.origin,
      DEMO_SHIPMENT.destination,
      DEMO_SHIPMENT.retailer,
      DEMO_SHIPMENT.quantityKg,
      DEMO_SHIPMENT.basePricePerKg,
      profile.referenceTempC,
      profile.referenceHumidityPct,
      profile.referenceShelfLifeHours,
      profile.q10,
      DEMO_SHIPMENT.transitHours,
      baseline.transitRemainingHours,
      baseline.equivalentAgeHours,
      reading.temperatureC,
      reading.humidityPct,
      a.remainingShelfLifeHours,
      a.margin,
      a.riskLevel,
      ts,
      ts,
    );

    db.prepare(
      `INSERT INTO marketplace_listings (id, shipment_id, base_price_per_kg, current_price_per_kg, discount_pct, status, updated_at)
       VALUES (?, ?, ?, ?, 0, 'NORMAL', ?)`,
    ).run(randomUUID(), id, DEMO_SHIPMENT.basePricePerKg, discountedPrice(DEMO_SHIPMENT.basePricePerKg, 0), ts);

    db.prepare(
      `INSERT INTO shelf_life_snapshots (id, shipment_id, telemetry_event_id, thermal_multiplier, humidity_multiplier,
        age_rate, equivalent_age_hours, remaining_equivalent_hours, remaining_shelf_life_hours,
        transit_remaining_hours, margin, risk_level, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      id,
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

    db.prepare(
      `INSERT INTO audit_logs (id, shipment_id, event_type, summary, detail_json, created_at)
       VALUES (?, ?, 'SHIPMENT_INITIALIZED', ?, ?, ?)`,
    ).run(
      randomUUID(),
      id,
      `Shipment ${DEMO_SHIPMENT.code} initialised at ${reading.temperatureC} °C / ${reading.humidityPct} % RH`,
      JSON.stringify({ riskLevel: a.riskLevel, remainingShelfLifeHours: a.remainingShelfLifeHours }),
      ts,
    );
    return id;
  });
}
