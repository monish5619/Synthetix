import type { Db } from './db.js';
import { decideLiquidation } from './liquidation.js';
import { classifyRisk, evaluateExposure } from './model.js';
import { getShipmentRow } from './pipeline.js';
import type { RiskLevel } from './config.js';
import type { TelemetryRequest } from './validation.js';

export interface TelemetryPreview {
  shipmentId: string;
  reading: { temperature: number; humidity: number; transitDuration: number };
  before: { remainingHours: number; riskLevel: RiskLevel; markdownPct: number };
  /** The model's own decomposition of this reading. */
  model: {
    modelVersion: string;
    temperatureStress: number;
    humidityFactor: number;
    equivalentAgeIncrement: number;
    cumulativeEquivalentAge: number;
  };
  after: { remainingHours: number; riskLevel: RiskLevel; transitRemainingHours: number };
  liquidation: {
    /** True when committing this reading would deepen the markdown and reprice the listing. */
    wouldReprice: boolean;
    markdownPct: number;
    recommendedPricePerKg: number;
    urgency: string;
  };
}

/**
 * What a reading WOULD do, using the same model and liquidation engine as the real
 * pipeline. It only reads: no event, snapshot, listing, alert or audit row is written,
 * so previewing can be done any number of times without changing anything.
 */
export function previewTelemetry(db: Db, request: TelemetryRequest): TelemetryPreview {
  const row = getShipmentRow(db, request.shipmentId);

  const output = evaluateExposure({
    baselineShelfLifeHours: row.baseline_shelf_life_hours,
    cumulativeBefore: row.cumulative_equivalent_age_hours,
    exposure: {
      temperatureC: request.temperature,
      humidityPct: request.humidity,
      exposureHours: request.transitDuration,
    },
  });

  const listing = db
    .prepare('SELECT discount_pct FROM marketplace_listings WHERE shipment_id = ?')
    .get(row.id) as { discount_pct: number };
  const decision = decideLiquidation({
    output,
    originalPricePerKg: row.original_price_per_kg,
    previousMarkdownPct: listing.discount_pct,
  });

  const beforeRemaining = Math.max(0, row.baseline_shelf_life_hours - row.cumulative_equivalent_age_hours);
  return {
    shipmentId: row.id,
    reading: { temperature: request.temperature, humidity: request.humidity, transitDuration: request.transitDuration },
    before: { remainingHours: beforeRemaining, riskLevel: classifyRisk(beforeRemaining), markdownPct: listing.discount_pct },
    model: {
      modelVersion: output.modelVersion,
      temperatureStress: output.temperatureStress,
      humidityFactor: output.humidityFactor,
      equivalentAgeIncrement: output.equivalentAgeIncrement,
      cumulativeEquivalentAge: output.cumulativeEquivalentAge,
    },
    after: {
      remainingHours: output.remainingHours,
      riskLevel: output.riskLevel,
      transitRemainingHours: Math.max(0, row.transit_remaining_hours - request.transitDuration),
    },
    liquidation: {
      wouldReprice: decision.deepened,
      markdownPct: decision.markdownPct,
      recommendedPricePerKg: decision.recommendedPricePerKg,
      urgency: decision.urgency,
    },
  };
}
