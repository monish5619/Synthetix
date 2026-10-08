import { beforeEach, describe, expect, it } from 'vitest';
import { LIQUIDATION_POLICY, MODEL_CONFIG } from '../server/config';
import { openDatabase, type Db } from '../server/db';
import { decideLiquidation, discountedPrice } from '../server/liquidation';
import { evaluateExposure } from '../server/model';
import { getShipmentDetail, ingestTelemetry, listTelemetry } from '../server/pipeline';
import { seedDemoShipment } from '../server/seed';
import { DEMO_SHIPMENT } from '../server/demo';
import { AMBIENT_SPIKE, NORMAL_READING } from '../server/simulator';

let db: Db;
let shipmentId: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  shipmentId = seedDemoShipment(db);
});

function ingest(temperature: number, humidity: number, transitDuration: number) {
  ingestTelemetry(db, { shipmentId, temperature, humidity, transitDuration });
  return getShipmentDetail(db, shipmentId);
}

const spike = () => ingest(AMBIENT_SPIKE.temperature, AMBIENT_SPIKE.humidity, AMBIENT_SPIKE.transitDuration);

function auditTypes() {
  return (db.prepare('SELECT event_type FROM audit_logs WHERE shipment_id = ? ORDER BY created_at, rowid').all(shipmentId) as {
    event_type: string;
  }[]).map((r) => r.event_type);
}

describe('liquidation engine', () => {
  it('maps each risk level to the configured markdown', () => {
    const output = evaluateExposure({
      baselineShelfLifeHours: 120,
      cumulativeBefore: 0,
      exposure: { temperatureC: 4, humidityPct: 60, exposureHours: 0 },
    });
    expect(decideLiquidation({ output: { ...output, riskLevel: 'NORMAL' }, originalPricePerKg: 100, previousMarkdownPct: 0 }).markdownPct).toBe(0);
    expect(decideLiquidation({ output: { ...output, riskLevel: 'WATCH' }, originalPricePerKg: 100, previousMarkdownPct: 0 }).markdownPct).toBe(10);
    expect(decideLiquidation({ output: { ...output, riskLevel: 'HIGH' }, originalPricePerKg: 100, previousMarkdownPct: 0 }).markdownPct).toBe(25);
    expect(decideLiquidation({ output: { ...output, riskLevel: 'CRITICAL' }, originalPricePerKg: 100, previousMarkdownPct: 0 }).markdownPct).toBe(35);
  });

  it('never lowers an existing markdown', () => {
    const output = evaluateExposure({
      baselineShelfLifeHours: 120,
      cumulativeBefore: 0,
      exposure: { temperatureC: 4, humidityPct: 60, exposureHours: 0 },
    });
    const d = decideLiquidation({ output, originalPricePerKg: 100, previousMarkdownPct: 35 });
    expect(d.markdownPct).toBe(35);
    expect(d.deepened).toBe(false);
  });

  it('prices a 35 % markdown on ₹100/kg at ₹65/kg', () => {
    expect(discountedPrice(100, 35)).toBe(65);
    expect(LIQUIDATION_POLICY.CRITICAL.markdownPct).toBe(35);
  });
});

describe('engine scenarios through the persisted pipeline', () => {
  it('7. liquidation recommendation carries risk, markdown, prices, urgency, reason and action', () => {
    const detail = spike();
    expect(detail.recommendations).toHaveLength(1);
    const rec = detail.recommendations[0];
    expect(rec).toMatchObject({
      riskLevel: 'CRITICAL',
      markdownPct: 35,
      originalPricePerKg: 100,
      recommendedPricePerKg: 65,
      urgency: 'IMMEDIATE',
      status: 'APPLIED',
    });
    expect(rec.reason).toBe(
      'Predicted shelf life has fallen below the critical liquidation threshold due to elevated thermal exposure and humidity.',
    );
    expect(rec.retailerAction).toContain('35% off');
    expect(rec.sellByHours).toBe(17);
  });

  it('8. marketplace listing updates, and repeat CRITICAL readings do not re-recommend', () => {
    let detail = spike();
    expect(detail.listing).toMatchObject({ currentPricePerKg: 65, discountPct: 35, status: 'LIQUIDATION' });

    detail = ingest(NORMAL_READING.temperature, NORMAL_READING.humidity, NORMAL_READING.transitDuration);
    expect(detail.listing.currentPricePerKg).toBe(65);
    expect(detail.recommendations).toHaveLength(1);
  });

  it('9. alerts fire on escalation into HIGH or CRITICAL, and not on repeat readings', () => {
    let detail = spike();
    expect(detail.alerts).toHaveLength(1);
    expect(detail.alerts[0]).toMatchObject({ severity: 'CRITICAL', recipient: DEMO_SHIPMENT.retailer });

    detail = ingest(NORMAL_READING.temperature, NORMAL_READING.humidity, NORMAL_READING.transitDuration);
    expect(detail.alerts).toHaveLength(1);
  });

  it('WATCH escalation liquidates at 10 % but raises no alert', () => {
    const detail = ingest(22, 60, 10);
    expect(detail.current.riskLevel).toBe('WATCH');
    expect(detail.listing).toMatchObject({ currentPricePerKg: 90, discountPct: 10 });
    expect(detail.alerts).toHaveLength(0);
    expect(auditTypes()).toContain('RISK_ESCALATED');
  });

  it('10. official scenario: 120 h → thermal event → about 18 h, CRITICAL, 35 % off, the model proves it', () => {
    // Independent recomputation from the published formula, not from the model code.
    const exposure = AMBIENT_SPIKE.transitDuration;
    const stress = Math.pow(MODEL_CONFIG.q10, (AMBIENT_SPIKE.temperature - MODEL_CONFIG.idealTemperatureC) / 10);
    const humidity = 1 + MODEL_CONFIG.humidityPenaltyPerPct * (AMBIENT_SPIKE.humidity - MODEL_CONFIG.humidityThresholdPct);
    const expectedRemaining = 120 - exposure * stress * humidity * MODEL_CONFIG.calibrationCoefficient;

    const before = getShipmentDetail(db, shipmentId);
    expect(before.current.remainingHours).toBe(120);
    expect(before.current.riskLevel).toBe('NORMAL');

    const detail = spike();
    expect(detail.current.remainingHours).toBeCloseTo(expectedRemaining, 8);
    expect(detail.current.remainingHours).toBeGreaterThan(17);
    expect(detail.current.remainingHours).toBeLessThan(18);
    expect(detail.current.riskLevel).toBe('CRITICAL');
    expect(detail.listing.discountPct).toBe(35);
    expect(detail.listing.currentPricePerKg).toBe(65);
    expect(detail.alerts).toHaveLength(1);

    // The result comes from the stored model run, with its full decomposition.
    expect(detail.latestModelRun).toMatchObject({
      exposureHours: 6.3,
      temperatureC: 30,
      humidityPct: 85,
      riskLevel: 'CRITICAL',
    });
    expect(detail.latestModelRun!.temperatureStress).toBeCloseTo(stress, 10);
    expect(detail.latestModelRun!.humidityFactor).toBeCloseTo(humidity, 10);
    expect(detail.current.explanation).toContain('Temperature of 30.0 °C increased above');
  });

  it('official scenario persists every artefact and leaves an audit trail with timestamps and shipment id', () => {
    spike();
    const types = auditTypes();
    for (const expected of [
      'SHIPMENT_INITIALIZED',
      'TELEMETRY_RECEIVED',
      'SHELF_LIFE_RECALCULATED',
      'RISK_ESCALATED',
      'LIQUIDATION_RECOMMENDED',
      'MARKETPLACE_UPDATED',
      'RETAILER_ALERT_GENERATED',
    ]) {
      expect(types).toContain(expected);
    }

    const rows = db
      .prepare('SELECT shipment_id, created_at, detail_json FROM audit_logs WHERE shipment_id = ?')
      .all(shipmentId) as { shipment_id: string; created_at: string; detail_json: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.shipment_id).toBe(shipmentId);
      expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
      expect(() => JSON.parse(row.detail_json)).not.toThrow();
    }

    const telemetry = listTelemetry(db, shipmentId);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].transitDuration).toBe(6.3);

    const snapshots = db.prepare('SELECT COUNT(*) AS n FROM shelf_life_snapshots WHERE shipment_id = ?').get(shipmentId) as { n: number };
    expect(snapshots.n).toBe(2); // baseline + spike
  });
});
