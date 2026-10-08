/**
 * Deterministic produce shelf-life model (no ML, no LLM).
 *
 *   reading (T, RH)
 *     → thermal multiplier  Q10^((T − Tref) / 10)          how much faster decay runs vs. reference
 *     → humidity multiplier 1 + 0.01 × max(0, RH − RHref)  extra decay above reference humidity
 *     → ageRate = thermal × humidity                        equivalent hours consumed per real hour
 *     → equivalent age += intervalHours × ageRate           cumulative damage (in reference hours)
 *     → remaining equivalent = L_ref − equivalent age       what is left of the reference life
 *     → remaining shelf life = remaining equivalent ÷ current ageRate   (real hours at current conditions)
 *     → margin = remaining shelf life ÷ remaining transit   (cover ratio; < 1 means spoilage before arrival)
 *     → risk level from margin
 */

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface ProductProfile {
  produce: string;
  referenceTempC: number;
  referenceHumidityPct: number;
  referenceShelfLifeHours: number;
  q10: number;
}

export interface Reading {
  temperatureC: number;
  humidityPct: number;
}

export const HUMIDITY_STRESS_PER_PCT = 0.01;
export const MARGIN_CAP = 99;
export const MAX_MARKDOWN_PCT = 60;

export function thermalMultiplier(tempC: number, profile: ProductProfile): number {
  return Math.pow(profile.q10, (tempC - profile.referenceTempC) / 10);
}

export function humidityMultiplier(humidityPct: number, profile: ProductProfile): number {
  return 1 + HUMIDITY_STRESS_PER_PCT * Math.max(0, humidityPct - profile.referenceHumidityPct);
}

export function ageRate(reading: Reading, profile: ProductProfile) {
  const thermal = thermalMultiplier(reading.temperatureC, profile);
  const humidity = humidityMultiplier(reading.humidityPct, profile);
  return { thermal, humidity, total: thermal * humidity };
}

export function classifyRisk(margin: number, remainingShelfLifeHours: number): RiskLevel {
  if (remainingShelfLifeHours <= 0 || margin < 1) return 'CRITICAL';
  if (margin < 1.25) return 'HIGH';
  if (margin < 2) return 'MODERATE';
  return 'LOW';
}

export interface Assessment {
  thermalMultiplier: number;
  humidityMultiplier: number;
  ageRate: number;
  equivalentAgeHours: number;
  remainingEquivalentHours: number;
  remainingShelfLifeHours: number;
  transitRemainingHours: number;
  margin: number;
  riskLevel: RiskLevel;
}

/** Pure assessment of a state after the latest reading has been applied. */
export function assess(
  profile: ProductProfile,
  state: { equivalentAgeHours: number; transitRemainingHours: number },
  reading: Reading,
): Assessment {
  const rate = ageRate(reading, profile);
  const remainingEquivalentHours = Math.max(0, profile.referenceShelfLifeHours - state.equivalentAgeHours);
  const remainingShelfLifeHours = remainingEquivalentHours / rate.total;
  const margin =
    state.transitRemainingHours > 0
      ? Math.min(MARGIN_CAP, remainingShelfLifeHours / state.transitRemainingHours)
      : remainingShelfLifeHours > 0
        ? MARGIN_CAP
        : 0;

  return {
    thermalMultiplier: rate.thermal,
    humidityMultiplier: rate.humidity,
    ageRate: rate.total,
    equivalentAgeHours: state.equivalentAgeHours,
    remainingEquivalentHours,
    remainingShelfLifeHours,
    transitRemainingHours: state.transitRemainingHours,
    margin,
    riskLevel: classifyRisk(margin, remainingShelfLifeHours),
  };
}

/** Applies one telemetry interval to the cumulative damage and transit clock. */
export function applyInterval(
  profile: ProductProfile,
  state: { equivalentAgeHours: number; transitRemainingHours: number },
  reading: Reading,
  intervalHours: number,
) {
  return {
    equivalentAgeHours: state.equivalentAgeHours + intervalHours * ageRate(reading, profile).total,
    transitRemainingHours: Math.max(0, state.transitRemainingHours - intervalHours),
  };
}

/** HIGH and CRITICAL risk trigger liquidation. */
export function requiresLiquidation(riskLevel: RiskLevel): boolean {
  return riskLevel === 'HIGH' || riskLevel === 'CRITICAL';
}

/**
 * Markdown from the shortfall: 10% at the liquidation boundary, rising 50 points
 * per unit of shortfall (1 − margin), capped at MAX_MARKDOWN_PCT.
 */
export function liquidationMarkdownPct(margin: number): number {
  const shortfall = Math.max(0, 1 - margin);
  return Math.min(MAX_MARKDOWN_PCT, Math.round(10 + 50 * shortfall));
}

export function discountedPrice(basePricePerKg: number, markdownPct: number): number {
  return Math.round(basePricePerKg * (1 - markdownPct / 100) * 100) / 100;
}
