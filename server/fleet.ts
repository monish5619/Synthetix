import { randomUUID } from 'node:crypto';
import { MODEL_CONFIG } from './config.js';
import { inTransaction, type Db } from './db.js';
import { discountedPrice } from './liquidation.js';
import { evaluateExposure } from './model.js';
import { audit, ingestTelemetry, insertSnapshot } from './pipeline.js';

/**
 * A small demo fleet, so the Fleet view has more than one truck to show.
 * Illustrative data only, seeded in demo mode and never in a real deployment.
 *
 * Each shipment is created at its baseline and then driven by REAL readings through
 * the real pipeline (`ingestTelemetry`), so every shelf-life figure, risk level and
 * price in the fleet is computed by the model, not typed in. The produce profile is
 * just the commodity and its reference shelf life; the model itself is shared.
 */
export interface FleetSpec {
  code: string;
  produce: string;
  origin: string;
  destination: string;
  retailer: string;
  quantityKg: number;
  originalPricePerKg: number;
  /** Reference shelf life of this commodity under ideal storage, in hours. */
  shelfLifeHours: number;
  transitHours: number;
  /** Readings applied in order after the shipment is created. */
  readings: Array<{ temperature: number; humidity: number; transitDuration: number }>;
}

export const FLEET: readonly FleetSpec[] = [
  {
    code: 'AS-1043',
    produce: 'Alphonso Mangoes',
    origin: 'Krishnagiri Orchard',
    destination: 'Salem',
    retailer: 'Salem Fruit Mart (demo partner)',
    quantityKg: 800,
    originalPricePerKg: 140,
    shelfLifeHours: 168,
    transitHours: 30,
    readings: [{ temperature: 4, humidity: 60, transitDuration: 6 }],
  },
  {
    code: 'AS-1044',
    produce: 'Spinach',
    origin: 'Ooty Farm Co-op',
    destination: 'Coimbatore',
    retailer: 'Coimbatore Fresh Market (demo partner)',
    quantityKg: 350,
    originalPricePerKg: 60,
    shelfLifeHours: 96,
    transitHours: 24,
    readings: [{ temperature: 12, humidity: 75, transitDuration: 10 }],
  },
  {
    code: 'AS-1045',
    produce: 'Bananas',
    origin: 'Theni Plantation',
    destination: 'Madurai',
    retailer: 'Madurai Greens (demo partner)',
    quantityKg: 1500,
    originalPricePerKg: 40,
    shelfLifeHours: 144,
    transitHours: 28,
    readings: [{ temperature: 4, humidity: 60, transitDuration: 4 }],
  },
  {
    code: 'AS-1046',
    produce: 'Milk',
    origin: 'Erode Dairy Union',
    destination: 'Tiruppur',
    retailer: 'Tiruppur Dairy Hub (demo partner)',
    quantityKg: 2000,
    originalPricePerKg: 52,
    shelfLifeHours: 84,
    transitHours: 20,
    readings: [{ temperature: 28, humidity: 70, transitDuration: 5 }],
  },
  {
    code: 'AS-1047',
    produce: 'Cut Flowers',
    origin: 'Hosur Flower Market',
    destination: 'Bengaluru',
    retailer: 'Bengaluru Blooms (demo partner)',
    quantityKg: 300,
    originalPricePerKg: 220,
    shelfLifeHours: 108,
    transitHours: 18,
    readings: [{ temperature: 4, humidity: 60, transitDuration: 3 }],
  },
];

/** Creates one fleet shipment at its baseline, then applies its readings through the real pipeline. */
function seedOne(db: Db, spec: FleetSpec): void {
  const id = randomUUID();
  const ts = new Date().toISOString();
  const initial = { temperatureC: 4, humidityPct: 60 };

  inTransaction(db, () => {
    const baseline = evaluateExposure({
      baselineShelfLifeHours: spec.shelfLifeHours,
      cumulativeBefore: 0,
      exposure: { ...initial, exposureHours: 0 },
    });
    db.prepare(
      `INSERT INTO shipments (id, code, produce, origin, destination, retailer, status, quantity_kg, original_price_per_kg,
        baseline_shelf_life_hours, transit_total_hours, transit_remaining_hours, cumulative_equivalent_age_hours,
        current_temperature_c, current_humidity_pct, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_TRANSIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, spec.code, spec.produce, spec.origin, spec.destination, spec.retailer, spec.quantityKg,
      spec.originalPricePerKg, spec.shelfLifeHours, spec.transitHours, spec.transitHours,
      baseline.cumulativeEquivalentAge, initial.temperatureC, initial.humidityPct, ts, ts,
    );
    db.prepare(
      `INSERT INTO marketplace_listings (id, shipment_id, current_price_per_kg, discount_pct, status, updated_at)
       VALUES (?, ?, ?, 0, 'NORMAL', ?)`,
    ).run(randomUUID(), id, discountedPrice(spec.originalPricePerKg, 0), ts);
    insertSnapshot(db, id, null, baseline, spec.transitHours, ts);
    audit(
      db, id, 'SHIPMENT_INITIALIZED',
      `Shipment ${spec.code} initialised at ${initial.temperatureC} °C / ${initial.humidityPct} % RH (Q10 ${MODEL_CONFIG.q10})`,
      { riskLevel: baseline.riskLevel, remainingHours: baseline.remainingHours, modelVersion: baseline.modelVersion },
      ts,
    );
  });

  for (const reading of spec.readings) ingestTelemetry(db, { shipmentId: id, ...reading });
}

/** Adds any missing fleet shipments. Safe to call on every start: existing ones are left alone. */
export function seedFleet(db: Db): number {
  let added = 0;
  for (const spec of FLEET) {
    const exists = db.prepare('SELECT 1 FROM shipments WHERE code = ?').get(spec.code);
    if (exists) continue;
    seedOne(db, spec);
    added++;
  }
  return added;
}
