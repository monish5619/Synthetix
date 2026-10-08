/**
 * Central configuration for the AgroSense decision engine.
 *
 * Every tunable number lives here so the model can be explained line by line.
 * Changing a value here changes model behaviour, so bump MODEL_VERSION with it.
 */

export const MODEL_VERSION = 'agro-q10-v1';

/**
 * Degradation model parameters.
 *
 *   temperatureStress      = q10 ^ ((T − idealTemperatureC) / 10)
 *   humidityFactor         = 1 + humidityPenaltyPerPct × max(0, RH − humidityThresholdPct)
 *   equivalentAgeIncrement = exposureHours × temperatureStress × humidityFactor × calibrationCoefficient
 *   remainingHours         = max(0, baselineShelfLifeHours − cumulativeEquivalentAge)
 */
export const MODEL_CONFIG = {
  /** Q10: how many times faster produce ages for every 10 °C above the ideal. Typical range 2–3. */
  q10: 2.5,
  /** Ideal storage temperature for the demo produce, in °C. */
  idealTemperatureC: 4,
  /** Relative humidity above which humidity starts to accelerate ageing, in %. */
  humidityThresholdPct: 60,
  /** Extra ageing per percentage point of humidity above the threshold (0.02 = +2 % per point). */
  humidityPenaltyPerPct: 0.02,
  /** Scale factor on ageing. 1.0 means uncalibrated. Recalibrate against observed spoilage data. */
  calibrationCoefficient: 1.0,
} as const;

/** Product baseline used for the demo shipment. */
export const DEMO_BASELINE = {
  shelfLifeHours: 120,
} as const;

/** Physically valid inputs. Telemetry outside these ranges is rejected. */
export const VALID_RANGES = {
  temperatureC: { min: -40, max: 60 },
  humidityPct: { min: 0, max: 100 },
  exposureHours: { min: 0, max: 24 },
} as const;

/** A reading this far above the ideal temperature is classed as a thermal excursion in history views. */
export const EXCURSION_ABOVE_IDEAL_C = 4;

export type RiskLevel = 'NORMAL' | 'WATCH' | 'HIGH' | 'CRITICAL';

/**
 * Risk bands on remaining shelf life, in hours:
 *   NORMAL    remaining > normalAboveHours
 *   WATCH     watchAboveHours < remaining ≤ normalAboveHours
 *   HIGH      criticalBelowHours ≤ remaining ≤ watchAboveHours
 *   CRITICAL  remaining < criticalBelowHours
 */
export const RISK_BANDS = {
  normalAboveHours: 72,
  watchAboveHours: 36,
  criticalBelowHours: 18,
} as const;

export const RISK_ORDER: Record<RiskLevel, number> = { NORMAL: 0, WATCH: 1, HIGH: 2, CRITICAL: 3 };

export type Urgency = 'NONE' | 'MONITOR' | 'PRIORITY' | 'IMMEDIATE';

export interface LiquidationRule {
  markdownPct: number;
  urgency: Urgency;
  retailerAction: string;
}

/**
 * Markdown policy by risk level. A recommendation is made only when the markdown
 * exceeds what the listing already carries. Discounts never rise back.
 */
export const LIQUIDATION_POLICY: Record<RiskLevel, LiquidationRule> = {
  NORMAL: {
    markdownPct: 0,
    urgency: 'NONE',
    retailerAction: 'No action. Keep the listing at the normal price.',
  },
  WATCH: {
    markdownPct: 10,
    urgency: 'MONITOR',
    retailerAction: 'Offer 10% off to nearby retailers for sale within the next day.',
  },
  HIGH: {
    markdownPct: 25,
    urgency: 'PRIORITY',
    retailerAction: 'Offer 25% off and prioritise same-day sale.',
  },
  CRITICAL: {
    markdownPct: 35,
    urgency: 'IMMEDIATE',
    retailerAction: 'Offer 35% off now. Retailers should sell before the remaining shelf life runs out.',
  },
};

export const LIQUIDATION_MAX_MARKDOWN_PCT = 60;
